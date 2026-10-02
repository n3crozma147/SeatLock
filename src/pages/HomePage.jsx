import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="home">
      <h1>SeatLock</h1>
      <p className="home__lead">Seat booking that stays fair when everyone clicks at the same moment.</p>
      <div className="home__how">
        <div>
          <h2>A line, not a stampede</h2>
          <p>Everyone gets a place in a virtual queue and is let in a few at a time.</p>
        </div>
        <div>
          <h2>Seats are held, not grabbed</h2>
          <p>Picking a seat holds it for you for a few minutes. If you don't pay in time, it goes back on sale.</p>
        </div>
        <div>
          <h2>Never sold twice</h2>
          <p>The database itself refuses a second hold or booking on the same seat.</p>
        </div>
      </div>
      <Link className="home__cta" to="/event/demo">
        Open the demo event
      </Link>
      <p className="home__tip">Open it in two browser windows to watch holds appear in real time.</p>
    </div>
  );
}
