// The slow retry tail after a 404 burst (lib/model.ts) is for production; tests that script a run of 404s expect the
// ladder to end the call, so it is off here unless a test sets MODEL_404_TAIL_MS itself.
process.env.MODEL_404_TAIL_MS = "0";
