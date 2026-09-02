# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Retenia, please **do not** open a public issue. Instead, please report it privately to:

**Email:** zeroframe404@gmail.com

Please include:
- A description of the vulnerability
- Steps to reproduce (if possible)
- Potential impact
- Suggested remediation (if you have one)

We will acknowledge your report within 48 hours and work with you on a resolution.

## Supported Versions

Security updates are provided for the latest version of Retenia. This is a pre-alpha project; once we reach a stable release, we will define a clearer security update policy.

## Security Considerations

Retenia is designed with security in mind:

- **Local-first:** Your data stays on your device by default
- **BYOK:** You provide and manage your own API keys
- **Electron hardening:** Context isolation, process security, and strict Content Security Policy
- **No telemetry by default:** Opt-in only
- **No remote code execution:** All updates are signed and verified

Please consult `CLAUDE.md` and `docs/spec/07-architecture.md` for architectural details on security.
