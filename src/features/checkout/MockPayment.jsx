import { Spinner } from '../../components/Spinner.jsx';

export function MockPayment() {
  return (
    <div className="mock-payment">
      <Spinner label="Confirming payment" />
      <p>This demo skips real payment. Your hold is checked again when it finishes.</p>
    </div>
  );
}
