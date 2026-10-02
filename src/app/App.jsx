import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { Banner } from '../components/Banner.jsx';
import { Spinner } from '../components/Spinner.jsx';
import { useAuth } from '../hooks/useAuth.js';
import EventPage from '../pages/EventPage.jsx';
import HomePage from '../pages/HomePage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

/** Remount the event page per event so no state leaks between events. */
function EventRoute({ uid }) {
  const { eventId } = useParams();
  return <EventPage key={eventId} uid={uid} />;
}

export default function App() {
  const { uid, ready, error } = useAuth();

  let content;
  if (!ready) {
    content = (
      <div className="page-center">
        <Spinner label="Signing you in" />
      </div>
    );
  } else if (error) {
    content = <Banner kind="error">Sign-in failed: {error.message}. Is anonymous auth enabled?</Banner>;
  } else {
    content = (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/event/:eventId" element={<EventRoute uid={uid} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    );
  }

  return (
    <BrowserRouter>
      <header className="app-header">
        <Link to="/" className="brand">
          SeatLock
        </Link>
      </header>
      <main className="app-main">{content}</main>
    </BrowserRouter>
  );
}
