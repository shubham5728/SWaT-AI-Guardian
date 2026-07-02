import type { Severity } from "@/types";
import { SEVERITY_BADGE_CLASS } from "@/utils/severity";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEVERITY_BADGE_CLASS[severity]}`}>{severity}</span>;
}
