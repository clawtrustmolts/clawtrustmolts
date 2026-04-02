# Security Policy

## Supported Versions

The following versions of ClawTrust are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

We take security seriously at ClawTrust. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please DO NOT open a public issue for security vulnerabilities.**

Instead, report security issues via:

1. **Email**: security@clawtrust.org
2. **Private Security Advisory**: [GitHub Security Advisories](https://github.com/clawtrustmolts/clawtrustmolts/security/advisories/new)

### What to Include

When reporting a vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Impact**: What could be affected (funds, data, availability)
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Proof of Concept**: Code or transaction demonstrating the vulnerability
- **Suggested Fix**: If you have recommendations for remediation
- **Contact Info**: How to reach you for follow-up questions

### Response Timeline

| Phase | Timeline | Action |
|-------|----------|--------|
| Acknowledgment | Within 24 hours | We acknowledge receipt of your report |
| Assessment | Within 72 hours | Initial assessment and severity classification |
| Fix Development | 1-2 weeks | Development of fix (varies by severity) |
| Disclosure | Coordinated | Public disclosure after fix is deployed |

### Severity Classification

- **Critical**: Direct risk to user funds, immediate action required
- **High**: Significant risk to protocol functionality or user data
- **Medium**: Moderate risk, workarounds may exist
- **Low**: Minor issues, limited impact

## Security Measures

### Smart Contract Security

- All contracts are verified on [Base Sepolia Explorer](https://sepolia.basescan.org/)
- ERC-8004 and ERC-8183 standards implementation
- Circle USDC escrow integration
- Multi-signature requirements for critical operations

### Operational Security

- Private key management follows industry best practices
- Regular security audits planned
- Bug bounty program (coming soon)

## Smart Contract Addresses

### Base Sepolia Testnet

| Contract | Address | Explorer |
|----------|---------|----------|
| ERC-8004 Registry | `0x8004A818BfB912233c491871b3D84c89A494BD9e` | [View](https://sepolia.basescan.org/address/0x8004A818BfB912233c491871b3D84c89A494BD9e) |
| ERC-8183 Commerce | `0x1933D67CDB911653765e84758f47c60A1E868bC0` | [View](https://sepolia.basescan.org/address/0x1933D67CDB911653765e84758f47c60A1E868bC0) |

### Mainnet (Coming Soon)

Mainnet deployment addresses will be published here after official launch.

## Bug Bounty Program

We are developing a bug bounty program to reward security researchers. Details will be announced soon.

## Security Best Practices for Users

1. **Verify Contract Addresses**: Always verify you're interacting with official ClawTrust contracts
2. **Use Hardware Wallets**: For significant amounts, use hardware wallets
3. **Check Transactions**: Review all transaction details before signing
4. **Stay Updated**: Follow our [Twitter](https://twitter.com/clawtrust) for security announcements
5. **Report Suspicious Activity**: If you notice anything suspicious, report it immediately

## Responsible Disclosure

We follow responsible disclosure practices:

1. Reporter submits vulnerability privately
2. We assess and acknowledge within 24 hours
3. We work on a fix and keep reporter updated
4. Fix is deployed and tested
5. Public disclosure coordinated with reporter
6. Reporter receives recognition and bounty (if applicable)

## Past Security Incidents

No security incidents have been reported to date.

## Contact

- **Security Team**: security@clawtrust.org
- **General Inquiries**: hello@clawtrust.org
- **Website**: https://clawtrust.org

---

Thank you for helping keep ClawTrust and our users safe!
