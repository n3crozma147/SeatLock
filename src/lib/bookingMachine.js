// The booking flow as an explicit state machine. Pure: no Firebase, no React.
//
//   loading ──► queued ──► selecting ──► requesting ──► holding ──► paying ──► booked
//      │                    ▲   ▲            │            │  │        │          │
//      └──(admitted)────────┘   └──(failed)──┘            │  │        │          │
//                               ▲◄──(expired / lost)──────┘  │        │          │
//                               ▲◄──releasing◄───────────────┘        │          │
//                               ▲◄──(confirm failed)──────────────────┘          │
//                               └◄──(book more)──────────────────────────────────┘

export const Phase = Object.freeze({
  LOADING: 'loading',
  QUEUED: 'queued',
  SELECTING: 'selecting',
  REQUESTING: 'requesting',
  HOLDING: 'holding',
  RELEASING: 'releasing',
  PAYING: 'paying',
  BOOKED: 'booked',
  ERROR: 'error',
});

export const initialBookingState = Object.freeze({
  phase: Phase.LOADING,
  selected: [], // seat IDs picked but not yet held
  holdIds: [], // seat IDs this client believes it holds
  notice: null, // { kind: 'info' | 'warn' | 'error', text }
  error: null,
});

const notice = (kind, text) => ({ kind, text });

export function bookingReducer(state, action) {
  const { phase } = state;
  switch (action.type) {
    case 'TICKET_ASSIGNED':
      if (phase !== Phase.LOADING) return state;
      return { ...state, phase: action.admitted ? Phase.SELECTING : Phase.QUEUED };

    case 'ADMITTED':
      if (phase !== Phase.QUEUED) return state;
      return { ...state, phase: Phase.SELECTING, notice: notice('info', "You're in. Pick your seats.") };

    case 'TOGGLE_SEAT': {
      if (phase !== Phase.SELECTING) return state;
      const isSelected = state.selected.includes(action.seatId);
      if (!isSelected && state.selected.length >= action.maxSeats) {
        return { ...state, notice: notice('warn', `You can pick up to ${action.maxSeats} seats.`) };
      }
      const selected = isSelected
        ? state.selected.filter((id) => id !== action.seatId)
        : [...state.selected, action.seatId];
      return { ...state, selected, notice: null };
    }

    case 'SELECTION_PRUNED':
      if (phase !== Phase.SELECTING) return state;
      return {
        ...state,
        selected: action.selected,
        notice: notice('warn', 'A seat you picked was just taken by someone else.'),
      };

    case 'HOLD_REQUESTED':
      if (phase !== Phase.SELECTING || state.selected.length === 0) return state;
      return { ...state, phase: Phase.REQUESTING, notice: null };

    case 'HOLD_SUCCEEDED':
      if (phase !== Phase.REQUESTING) return state;
      return { ...state, phase: Phase.HOLDING, holdIds: action.seatIds, selected: [] };

    case 'HOLD_FAILED':
      if (phase !== Phase.REQUESTING) return state;
      return {
        ...state,
        phase: Phase.SELECTING,
        selected: action.stillFree ?? state.selected,
        notice: notice('error', action.message),
      };

    case 'HOLDS_DETECTED': // e.g. after a page refresh while holding seats
      if (phase !== Phase.SELECTING) return state;
      return { ...state, phase: Phase.HOLDING, holdIds: action.seatIds, selected: [] };

    case 'HOLD_LOST':
      if (phase !== Phase.HOLDING) return state;
      return {
        ...state,
        phase: Phase.SELECTING,
        holdIds: [],
        notice: notice('warn', 'Your hold ran out, so those seats are back on sale.'),
      };

    case 'RELEASE_REQUESTED':
      if (phase !== Phase.HOLDING) return state;
      return { ...state, phase: Phase.RELEASING };

    case 'RELEASED':
      if (phase !== Phase.RELEASING) return state;
      return { ...state, phase: Phase.SELECTING, holdIds: [], notice: notice('info', 'Seats released.') };

    case 'RELEASE_FAILED':
      if (phase !== Phase.RELEASING) return state;
      return { ...state, phase: Phase.HOLDING, notice: notice('error', action.message) };

    case 'PAYMENT_STARTED':
      if (phase !== Phase.HOLDING) return state;
      return { ...state, phase: Phase.PAYING, notice: null };

    case 'CONFIRM_SUCCEEDED':
      if (phase !== Phase.PAYING) return state;
      return { ...state, phase: Phase.BOOKED, holdIds: [] };

    case 'CONFIRM_FAILED':
      if (phase !== Phase.PAYING) return state;
      return { ...state, phase: Phase.SELECTING, holdIds: [], notice: notice('error', action.message) };

    case 'BOOK_MORE':
      if (phase !== Phase.BOOKED) return state;
      return { ...state, phase: Phase.SELECTING, notice: null };

    case 'DISMISS_NOTICE':
      return { ...state, notice: null };

    case 'FATAL':
      return { ...state, phase: Phase.ERROR, error: action.message };

    default:
      return state;
  }
}
