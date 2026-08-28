#!/bin/bash
# E2E Test Runner Script
# Provides convenient commands for running different test scenarios

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to display help
show_help() {
    cat << EOF
E2E Test Runner for DukaPay

Usage: ./run-tests.sh [COMMAND] [OPTIONS]

Commands:
  all                 Run all E2E tests (excluding flaky)
  flaky              Run only flaky tests
  flow <name>        Run tests for specific flow
  browser <name>     Run tests in specific browser (chromium/firefox/webkit)
  debug <test>       Run specific test in debug mode
  ui                 Open Playwright UI mode
  report             Show last test report
  help               Show this help message

Flow names:
  kyc                Agent onboarding & KYC
  cash               Cash-in/out (remittance)
  loan               Loan application, approval, funding
  repayment          Loan repayment
  dispute            Dispute filing
  float              Float transfer
  settlement         Settlement processing
  journey            Complete user journey

Examples:
  ./run-tests.sh all
  ./run-tests.sh flow loan
  ./run-tests.sh browser firefox
  ./run-tests.sh debug "loan application"
  ./run-tests.sh ui

EOF
}

# Check if npx is available
if ! command -v npx &> /dev/null; then
    print_error "npx not found. Please install Node.js and npm."
    exit 1
fi

# Main command handling
case "${1:-help}" in
    all)
        print_info "Running all E2E tests (excluding flaky)..."
        npx playwright test --grep-invert="@flaky"
        ;;
    
    flaky)
        print_info "Running flaky tests..."
        print_warning "These tests may fail intermittently"
        npx playwright test --grep="@flaky"
        ;;
    
    flow)
        if [ -z "$2" ]; then
            print_error "Please specify a flow name"
            show_help
            exit 1
        fi
        
        case "$2" in
            kyc)
                print_info "Running Agent Onboarding & KYC tests..."
                npx playwright test flows/01-agent-onboarding-kyc
                ;;
            cash)
                print_info "Running Cash-in/out tests..."
                npx playwright test flows/02-cash-in-out
                ;;
            loan)
                print_info "Running Loan Application tests..."
                npx playwright test flows/03-loan-application-approval-funding
                ;;
            repayment)
                print_info "Running Loan Repayment tests..."
                npx playwright test flows/04-loan-repayment
                ;;
            dispute)
                print_info "Running Dispute Filing tests..."
                npx playwright test flows/05-dispute-filing
                ;;
            float)
                print_info "Running Float Transfer tests..."
                npx playwright test flows/06-float-transfer
                ;;
            settlement)
                print_info "Running Settlement tests..."
                npx playwright test flows/07-settlement
                ;;
            journey)
                print_info "Running Complete User Journey tests..."
                npx playwright test flows/08-complete-user-journey
                ;;
            *)
                print_error "Unknown flow: $2"
                show_help
                exit 1
                ;;
        esac
        ;;
    
    browser)
        if [ -z "$2" ]; then
            print_error "Please specify a browser (chromium/firefox/webkit)"
            exit 1
        fi
        
        print_info "Running tests in $2..."
        npx playwright test --project="$2"
        ;;
    
    debug)
        if [ -z "$2" ]; then
            print_error "Please specify a test name or pattern"
            exit 1
        fi
        
        print_info "Running test in debug mode: $2"
        npx playwright test --grep="$2" --debug
        ;;
    
    ui)
        print_info "Opening Playwright UI mode..."
        npx playwright test --ui
        ;;
    
    report)
        print_info "Opening test report..."
        npx playwright show-report
        ;;
    
    help|--help|-h)
        show_help
        ;;
    
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac

print_info "Done!"
