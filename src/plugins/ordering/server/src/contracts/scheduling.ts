import type { AvailabilityResult, Hold, JsonObject, SlotSelection, ValidationResult } from './common';
import type { Order } from './entities';

/** Scheduling policy and provider contract (contracts doc §9). */
export type SchedulePolicy = {
  locationRef: string;
  fulfillmentKind: string;
  timezone: string;
  businessDayPolicy: {
    startLocalTime: string;
    cutoffLocalTime?: string;
    holidayDates: string[];
  };
  openingHours: JsonObject;
  leadTimeMinutes: number;
  slotLengthMinutes: number;
  bufferMinutes: number;
  maxAdvanceDays: number;
  capacity: number;
  blackoutPeriods: JsonObject[];
};

export interface SchedulingProvider {
  code: string;
  getAvailability(input: {
    locationRef: string;
    fulfillmentKind: string;
    at: string;
  }): Promise<AvailabilityResult>;
  listSlots(input: {
    scheduleRef: string;
    from: string;
    to: string;
    quantity: number;
  }): Promise<SlotSelection[]>;
  validateSlot(input: { slot: SlotSelection; quantity: number }): Promise<ValidationResult>;
  reserveSlot(input: {
    order: Order;
    slot: SlotSelection;
    quantity: number;
    expiresAt: string;
  }): Promise<Hold>;
  releaseSlot(input: { hold: Hold; reason: string }): Promise<void>;
}
