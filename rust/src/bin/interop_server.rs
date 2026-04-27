use std::{
    collections::HashMap,
    env,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
};

use serde_json::json;
use solana_mpp::server::{ChargeOptions, Config, Mpp};
use solana_mpp::solana_keychain::{memory::MemorySigner, SolanaSigner};
use solana_mpp::{
    format_www_authenticate, parse_authorization, AUTHORIZATION_HEADER, PAYMENT_RECEIPT_HEADER,
    WWW_AUTHENTICATE_HEADER,
};

const DEFAULT_RESOURCE_PATH: &str = "/protected";
const HEALTH_PATH: &str = "/health";
const DEFAULT_PRICE: &str = "0.001";
const DEFAULT_SECRET_KEY: &str = "mpp-interop-secret-key";
const DEFAULT_SETTLEMENT_HEADER: &str = "x-fixture-settlement";
const TOKEN_DECIMALS: u8 = 6;

#[derive(Clone)]
struct InteropState {
    mpp: Mpp,
    price: String,
    resource_path: String,
    settlement_header: String,
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = Arc::new(read_state()?);
    let runtime = Arc::new(tokio::runtime::Runtime::new()?);
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();

    println!(
        "{}",
        serde_json::to_string(&json!({
            "type": "ready",
            "implementation": "rust",
            "role": "server",
            "port": port,
            "capabilities": ["charge"],
        }))?
    );

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                let runtime = Arc::clone(&runtime);
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &state, &runtime) {
                        eprintln!("interop rust server error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("interop rust server accept error: {error}"),
        }
    }

    Ok(())
}

fn read_state() -> Result<InteropState, Box<dyn std::error::Error + Send + Sync>> {
    let rpc_url = read_required_env("MPP_INTEROP_RPC_URL")?;
    let network = env::var("MPP_INTEROP_NETWORK").unwrap_or_else(|_| "localnet".to_string());
    let mint = read_required_env("MPP_INTEROP_MINT")?;
    let pay_to = read_required_env("MPP_INTEROP_PAY_TO")?;
    let fee_payer: Arc<dyn SolanaSigner> =
        Arc::new(read_memory_signer("MPP_INTEROP_FEE_PAYER_SECRET_KEY")?);
    let price = env::var("MPP_INTEROP_PRICE").unwrap_or_else(|_| DEFAULT_PRICE.to_string());
    let secret_key =
        env::var("MPP_INTEROP_SECRET_KEY").unwrap_or_else(|_| DEFAULT_SECRET_KEY.to_string());

    Ok(InteropState {
        mpp: Mpp::new(Config {
            recipient: pay_to,
            currency: mint,
            decimals: TOKEN_DECIMALS,
            network,
            rpc_url: Some(rpc_url),
            secret_key: Some(secret_key),
            realm: Some("MPP Interop".to_string()),
            fee_payer: true,
            fee_payer_signer: Some(fee_payer),
            store: None,
            html: false,
        })?,
        price,
        resource_path: DEFAULT_RESOURCE_PATH.to_string(),
        settlement_header: DEFAULT_SETTLEMENT_HEADER.to_string(),
    })
}

fn handle_connection(
    mut stream: TcpStream,
    state: &InteropState,
    runtime: &tokio::runtime::Runtime,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    if request_line.trim().is_empty() {
        return Ok(());
    }

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            headers.insert(name.to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    match (method, path) {
        ("GET", HEALTH_PATH) => write_json_response(&mut stream, 200, &[], &json!({ "ok": true }))?,
        ("GET", path) if path == state.resource_path => {
            if let Some(authorization) = headers.get(AUTHORIZATION_HEADER) {
                match settle_payment(state, runtime, authorization) {
                    Ok((receipt_header, settlement)) => {
                        write_json_response(
                            &mut stream,
                            200,
                            &[
                                (PAYMENT_RECEIPT_HEADER, receipt_header.as_str()),
                                (state.settlement_header.as_str(), settlement.as_str()),
                            ],
                            &json!({
                                "ok": true,
                                "paid": true,
                                "settlement": {
                                    "success": true,
                                    "transaction": settlement,
                                }
                            }),
                        )?;
                    }
                    Err(error) => {
                        let challenge_header = payment_challenge_header(state)?;
                        write_json_response(
                            &mut stream,
                            402,
                            &[(WWW_AUTHENTICATE_HEADER, challenge_header.as_str())],
                            &json!({
                                "error": "payment_invalid",
                                "message": error.to_string(),
                            }),
                        )?;
                    }
                }
            } else {
                let challenge_header = payment_challenge_header(state)?;
                write_json_response(
                    &mut stream,
                    402,
                    &[(WWW_AUTHENTICATE_HEADER, challenge_header.as_str())],
                    &json!({ "error": "payment_required" }),
                )?;
            }
        }
        _ => write_json_response(&mut stream, 404, &[], &json!({ "error": "not_found" }))?,
    }

    Ok(())
}

fn payment_challenge_header(
    state: &InteropState,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let challenge = state.mpp.charge_with_options(
        &state.price,
        ChargeOptions {
            description: Some("Surfpool-backed protected content"),
            fee_payer: true,
            ..Default::default()
        },
    )?;
    Ok(format_www_authenticate(&challenge)?)
}

fn settle_payment(
    state: &InteropState,
    runtime: &tokio::runtime::Runtime,
    authorization: &str,
) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>> {
    let credential = parse_authorization(authorization)?;
    let receipt = runtime.block_on(state.mpp.verify_credential(&credential))?;
    let settlement = receipt.reference.clone();
    Ok((receipt.to_header()?, settlement))
}

fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    headers: &[(&str, &str)],
    body: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let body = serde_json::to_string(body)?;
    let reason = match status {
        200 => "OK",
        402 => "Payment Required",
        404 => "Not Found",
        _ => "Internal Server Error",
    };

    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n",
        body.len()
    )?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "\r\n{body}")?;
    stream.flush()?;
    Ok(())
}

fn read_required_env(name: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    env::var(name).map_err(|_| format!("{name} is required").into())
}

fn read_memory_signer(
    name: &str,
) -> Result<MemorySigner, Box<dyn std::error::Error + Send + Sync>> {
    let raw = read_required_env(name)?;
    let bytes: Vec<u8> = serde_json::from_str(&raw)?;
    Ok(MemorySigner::from_bytes(&bytes)?)
}
