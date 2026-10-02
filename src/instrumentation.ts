import { assertRateLimitTopology } from "@/lib/security/instance-topology";


export function register(): void {
  assertRateLimitTopology(process.env);
}
