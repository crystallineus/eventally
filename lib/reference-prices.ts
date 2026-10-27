// Hand-compiled reference ranges for common small repairs (San Jose area, 2026).
// These are rough estimates for demo purposes, not market data: the agent may only use
// them as a hint ("within / above the usual range"), never to reject a claim.

export const PRICE_CATEGORIES = {
  plumber_labor_per_hour: { label: "Plumber labor, per hour", lowCents: 9500, highCents: 18500 },
  plumber_service_call: { label: "Plumber visit for a small fix, labor only", lowCents: 12000, highCents: 35000 },
  sink_trap_or_drain_parts: { label: "Sink P-trap / drain parts", lowCents: 1000, highCents: 6000 },
  faucet_replacement_parts: { label: "Kitchen or bathroom faucet, parts", lowCents: 6000, highCents: 30000 },
  electrician_service_call: { label: "Electrician visit for a small fix, labor only", lowCents: 15000, highCents: 40000 },
  window_screen_repair: { label: "Window screen repair or rescreen", lowCents: 2500, highCents: 9000 },
  appliance_repair_service_call: { label: "Appliance repair visit, labor only", lowCents: 10000, highCents: 30000 },
  locksmith_rekey: { label: "Locksmith rekey, one lock", lowCents: 7500, highCents: 20000 },
} as const;

export type PriceCategory = keyof typeof PRICE_CATEGORIES;
