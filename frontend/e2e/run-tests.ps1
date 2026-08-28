# E2E Test Runner Script for Windows PowerShell
# Provides convenient commands for running different test scenarios

param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    
    [Parameter(Position=1)]
    [string]$Argument = ""
)

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Show-Help {
    Write-Host @"
E2E Test Runner for DukaPay

Usage: .\run-tests.ps1 [COMMAND] [OPTIONS]

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
  .\run-tests.ps1 all
  .\run-tests.ps1 flow loan
  .\run-tests.ps1 browser firefox
  .\run-tests.ps1 debug "loan application"
  .\run-tests.ps1 ui
"@
}

# Check if npx is available
$npxVersion = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxVersion) {
    Write-Error-Custom "npx not found. Please install Node.js and npm."
    exit 1
}

# Main command handling
switch ($Command) {
    "all" {
        Write-Info "Running all E2E tests (excluding flaky)..."
        npx playwright test --grep-invert="@flaky"
    }
    
    "flaky" {
        Write-Info "Running flaky tests..."
        Write-Warning-Custom "These tests may fail intermittently"
        npx playwright test --grep="@flaky"
    }
    
    "flow" {
        if ([string]::IsNullOrEmpty($Argument)) {
            Write-Error-Custom "Please specify a flow name"
            Show-Help
            exit 1
        }
        
        switch ($Argument) {
            "kyc" {
                Write-Info "Running Agent Onboarding & KYC tests..."
                npx playwright test flows/01-agent-onboarding-kyc
            }
            "cash" {
                Write-Info "Running Cash-in/out tests..."
                npx playwright test flows/02-cash-in-out
            }
            "loan" {
                Write-Info "Running Loan Application tests..."
                npx playwright test flows/03-loan-application-approval-funding
            }
            "repayment" {
                Write-Info "Running Loan Repayment tests..."
                npx playwright test flows/04-loan-repayment
            }
            "dispute" {
                Write-Info "Running Dispute Filing tests..."
                npx playwright test flows/05-dispute-filing
            }
            "float" {
                Write-Info "Running Float Transfer tests..."
                npx playwright test flows/06-float-transfer
            }
            "settlement" {
                Write-Info "Running Settlement tests..."
                npx playwright test flows/07-settlement
            }
            "journey" {
                Write-Info "Running Complete User Journey tests..."
                npx playwright test flows/08-complete-user-journey
            }
            default {
                Write-Error-Custom "Unknown flow: $Argument"
                Show-Help
                exit 1
            }
        }
    }
    
    "browser" {
        if ([string]::IsNullOrEmpty($Argument)) {
            Write-Error-Custom "Please specify a browser (chromium/firefox/webkit)"
            exit 1
        }
        
        Write-Info "Running tests in $Argument..."
        npx playwright test --project="$Argument"
    }
    
    "debug" {
        if ([string]::IsNullOrEmpty($Argument)) {
            Write-Error-Custom "Please specify a test name or pattern"
            exit 1
        }
        
        Write-Info "Running test in debug mode: $Argument"
        npx playwright test --grep="$Argument" --debug
    }
    
    "ui" {
        Write-Info "Opening Playwright UI mode..."
        npx playwright test --ui
    }
    
    "report" {
        Write-Info "Opening test report..."
        npx playwright show-report
    }
    
    "help" {
        Show-Help
    }
    
    default {
        Write-Error-Custom "Unknown command: $Command"
        Show-Help
        exit 1
    }
}

Write-Info "Done!"
