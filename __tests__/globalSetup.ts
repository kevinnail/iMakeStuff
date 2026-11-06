// Every test runs in New York time, so the daylight saving tests get a 25 and a 23 hour day on
// any machine, including CI's UTC runner. Setting TZ inside a test file does nothing: Jest gives
// each file its own copy of process.env, so Node's time zone never changes.
export default function globalSetup() {
  process.env.TZ = 'America/New_York';
}
