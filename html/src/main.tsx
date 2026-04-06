import React from 'react';
import { createRoot } from 'react-dom/client';
import { PaymentPage } from './payment-page';
import { DATA_ELEMENT_ID } from './config';
import type { EmbeddedData } from './config';

const dataEl = document.getElementById(DATA_ELEMENT_ID);
if (!dataEl?.textContent) {
  throw new Error(`Missing #${DATA_ELEMENT_ID} element with challenge data`);
}

const data: EmbeddedData = JSON.parse(dataEl.textContent);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}

createRoot(rootEl).render(<PaymentPage data={data} />);
