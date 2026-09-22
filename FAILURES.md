# Failure modes, fixes, and results

Honest engineering notes for this project. Nothing here is invented for polish.

## What can go wrong

- **Open SSH, public S3, failed ECS tasks, CPU spikes.** Exactly what Chaos Lab injects. Impact: exposure or outage on the demo estate. Mitigation: Config/EventBridge detect, Step Functions classify, remediator restores Block Public Access / revokes `22/tcp` / scales or notifies (`docs/CHAOS-LAB.md`, `docs/INCIDENT-RESPONSE.md`).
- **Auto-remediate in the wrong environment.** Impact: unexpected mutation. Mitigation: `dev` ships `AUTO_REMEDIATE`; `production-demo` ships `APPROVAL_REQUIRED`; GuardDuty isolation and encryption flips stay off the automatic path.
- **Config evaluation lag in a live interview.** Impact: demo looks stuck. Mitigation: inject `open-security-group` first; classifier also accepts a synthetic EventBridge payload.
- **Pointing Chaos Lab at a shared production account.** Impact: real blast radius. Mitigation: injectors only touch AegisCloud-tagged resources or stack outputs; `SECURITY.md` requires authorized accounts only.

## What went wrong

**No recorded production incident in this repo yet.** The "incidents" in docs are **designed walkthroughs** for the Chaos Lab (example timeline ~7s for open security group), not tickets from a live customer estate.

Documented design constraint: Config is not instant; ECS failure remediation is diagnostics + notify (approval), not silent restart of everything.

## How it was resolved

- First-wave classifications and default actions are tabulated in `docs/INCIDENT-RESPONSE.md`.
- ASL workflow checked in at `workflows/incident-response/definition.asl.json`; CDK is deployable source of truth.
- Evidence and incident records write back to the incidents table / evidence bucket for review (`aegis incidents`).

## Results

- Interview demo path: `aegis chaos inject open-security-group` then `aegis incidents` / `aegis status`.
- No independent production MTTR metrics are published beyond the illustrative walkthrough timings in the README.
- Successful local/AWS demo: synth/deploy `dev`, run one injector, confirm Config returns COMPLIANT and the incident closes as AUTO-REMEDIATED when auto mode is on.
