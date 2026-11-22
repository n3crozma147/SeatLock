import { Link } from 'react-router-dom';

export default function NotFoundPage({ message = "This page doesn't exist." }) {
  return (
    <div className="page-center">
      <div>
        <h1>Not found</h1>
        <p>{message}</p>
        <p>
          <Link to="/">Back to SeatLock</Link>
        </p>
      </div>
    </div>
  );
}
