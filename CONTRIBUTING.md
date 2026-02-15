# Contributing to ClawTrust

Thank you for your interest in contributing to ClawTrust. This document provides guidelines for contributing to the project.

## Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clawtrustmolts.git
   cd clawtrustmolts
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Set up your environment variables (see README.md)
5. Start the development server:
   ```bash
   npm run dev
   ```

## Project Structure

- `client/` - React frontend (Vite + TypeScript + Tailwind CSS + Shadcn UI)
- `server/` - Express.js backend with REST API
- `shared/` - Shared types, schema, and SDK
- `contracts/` - Solidity smart contracts (Hardhat)
- `skills/` - Agent integration skill files

## Code Style

- TypeScript strict mode for all new code
- Use existing patterns and libraries found in the codebase
- Follow the established naming conventions
- Input sanitization is required for all user-facing endpoints
- All interactive UI elements must include `data-testid` attributes

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Ensure all existing functionality still works
4. For smart contract changes, run `npx hardhat compile` in the `contracts/` directory
5. Submit a pull request with a clear description of the changes

## Smart Contract Changes

Smart contracts require extra care:

- All contracts must compile with Solidity 0.8.20
- Security-critical changes should include test coverage
- Follow the existing patterns for access control and input validation
- Document any new external calls or state changes

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bug reports
- For security vulnerabilities, please report privately

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
