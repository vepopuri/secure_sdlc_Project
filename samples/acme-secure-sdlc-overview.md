# Acme Payments - Secure SDLC overview

## Governance
The application security program has a charter owned by the CISO and a two-year roadmap approved by the steering committee.
Security policy and the secure coding standard are published on the intranet and reviewed annually.
Metrics such as mean time to remediate and SAST coverage are reported monthly on a dashboard.
All developers complete secure coding training during onboarding; a security champion sits in each squad.

## Design
Threat modeling with STRIDE is performed for new features using data flow diagrams.
Security requirements are derived from OWASP ASVS level 2 and added as acceptance criteria to user stories.
A security architecture review is mandatory for internet-facing services.

## Build and test
Every pull request requires peer code review and CODEOWNERS approval; branch protection is enforced on main.
SAST with Semgrep runs automatically in the GitHub Actions pipeline and blocks merges on high findings.
Dependabot raises dependency updates; SCA findings are tracked in Jira with remediation SLAs.
Secrets are stored in HashiCorp Vault and gitleaks secret scanning runs on every commit.
We do not yet produce an SBOM, and there is no DAST in the pipeline.
An external penetration test is performed annually before the peak season release.

## Deploy and operate
Deployments are automated through Argo CD with a change advisory approval for production.
Container images are scanned with Trivy and Terraform is scanned with Checkov before apply.
Logs are centralised in Splunk (SIEM) with alerting on authentication failures.
An incident response playbook exists but tabletop exercises are ad hoc.
