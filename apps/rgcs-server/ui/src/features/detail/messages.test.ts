import { vm } from "../../test/vm";
import { describe, expect, it } from "vitest";
import { EMPTY_MESSAGES, ack, forVehicle, unread } from "./messages";

const m = (id: number, sysid = 1) =>
  vm({ id, sysid, severity: 6, text: `m${id}`, ts: id });

describe("message bookkeeping", () => {
  it("ack is immutable and idempotent", () => {
    const s1 = ack(EMPTY_MESSAGES, 2);
    expect(EMPTY_MESSAGES.acked.size).toBe(0);
    expect(s1.acked.has(2)).toBe(true);
    expect(ack(s1, 2)).toBe(s1);
  });

  it("unread counts a vehicle’s messages that are not acked", () => {
    const list = [m(3), m(2), m(1, 2)];
    expect(unread(list, 1, EMPTY_MESSAGES.acked)).toBe(2);
    expect(unread(list, 1, ack(EMPTY_MESSAGES, 3).acked)).toBe(1);
    expect(forVehicle(list, 2).map((x) => x.id)).toEqual([1]);
  });
});
