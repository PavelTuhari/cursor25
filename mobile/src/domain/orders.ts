/** Order status handling and the delivery/pickup slots offered at checkout. */
import type { CartConfig } from '../config/types';

export const ORDER_STATUSES = [
  'new',
  'confirmed',
  'picking',
  'ready',
  'delivering',
  'completed',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Steps shown in the progress strip; `cancelled` is outside the happy path. */
const PROGRESS: OrderStatus[] = ['new', 'confirmed', 'picking', 'ready', 'completed'];
const DELIVERY_PROGRESS: OrderStatus[] = ['new', 'confirmed', 'picking', 'delivering', 'completed'];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function orderStatusKey(status: unknown): string {
  return `order.status.${isOrderStatus(status) ? status : 'new'}`;
}

export function orderProgress(status: unknown, fulfillment: string | null | undefined): {
  steps: OrderStatus[];
  index: number;
  done: boolean;
  cancelled: boolean;
} {
  const steps = fulfillment === 'delivery' ? DELIVERY_PROGRESS : PROGRESS;
  if (status === 'cancelled') return { steps, index: -1, done: false, cancelled: true };
  const current = isOrderStatus(status) ? status : 'new';
  const index = steps.indexOf(current);
  return {
    steps,
    index: index >= 0 ? index : 0,
    done: current === 'completed',
    cancelled: false,
  };
}

/** A customer may still cancel until the order is being picked. */
export function isCancellable(status: unknown): boolean {
  return status === 'new' || status === 'confirmed';
}

export function isOrderOpen(status: unknown): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

export interface DeliverySlot {
  /** `YYYY-MM-DD` */
  date: string;
  time: string;
}

export interface SlotDay {
  date: string;
  times: string[];
}

/**
 * Slots for the next `slotDays` days. Today only keeps the windows that have
 * not started yet, so nobody can order into the past.
 */
export function availableSlots(config: CartConfig, now = new Date()): SlotDay[] {
  const days: SlotDay[] = [];
  for (let offset = 0; offset < config.slotDays; offset += 1) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() + offset);
    const date = toDateString(day);
    const times = config.slotHours.filter((slot) => offset > 0 || slotStartsLater(slot, now));
    if (times.length > 0) days.push({ date, times });
  }
  return days;
}

function slotStartsLater(slot: string, now: Date): boolean {
  const [from] = slot.split('-');
  const match = /^(\d{1,2}):(\d{2})$/.exec((from ?? '').trim());
  if (!match) return false;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > now.getHours() * 60 + now.getMinutes();
}

export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Order numbers are assigned by the backend; until then the local id is shown. */
export function orderLabel(order: { number?: string | null; id: string }): string {
  return order.number && order.number.length > 0 ? order.number : order.id.slice(-6).toUpperCase();
}
