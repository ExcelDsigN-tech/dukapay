import {
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  Address,
  StrKey,
} from '@stellar/stellar-sdk';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import {
  createSorobanRpcServer,
  getStellarNetworkPassphrase,
} from '../config/stellar.js';
import { cacheService } from './cacheService.js';

const SIMULATION_CACHE_TTL = 30; // 30 seconds

interface SimulationArg {
  type: string;
  value: unknown;
}

interface SimulationResult {
  success: boolean;
  gasEstimate: string;
  resultXdr?: string;
  returnValue?: unknown;
  error?: string;
  warnings: string[];
  balanceDeltas: Array<{ address: string; asset: string; delta: string }>;
  cached: boolean;
  simulatedAt: string;
}

function convertArgToScVal(arg: SimulationArg): ReturnType<typeof nativeToScVal> {
  switch (arg.type) {
    case 'address':
      return nativeToScVal(Address.fromString(arg.value as string), { type: 'address' });
    case 'u32':
      return nativeToScVal(Number(arg.value), { type: 'u32' });
    case 'i32':
      return nativeToScVal(Number(arg.value), { type: 'i32' });
    case 'u64':
      return nativeToScVal(BigInt(arg.value as string | number), { type: 'u64' });
    case 'i64':
      return nativeToScVal(BigInt(arg.value as string | number), { type: 'i64' });
    case 'u128':
      return nativeToScVal(BigInt(arg.value as string | number), { type: 'u128' });
    case 'i128':
      return nativeToScVal(BigInt(arg.value as string | number), { type: 'i128' });
    case 'bool':
      return nativeToScVal(Boolean(arg.value), { type: 'bool' });
    case 'string':
      return nativeToScVal(String(arg.value), { type: 'string' });
    case 'symbol':
      return nativeToScVal(String(arg.value), { type: 'symbol' });
    case 'void':
      return nativeToScVal(undefined, { type: 'void' });
    default:
      return nativeToScVal(String(arg.value), { type: 'string' });
  }
}

function generateCacheKey(contractId: string, function_: string, args: SimulationArg[], sourceAccount: string): string {
  const argsHash = JSON.stringify(args);
  return `sim:${contractId}:${function_}:${sourceAccount}:${argsHash}`;
}

function extractWarnings(simulation: unknown): string[] {
  const warnings: string[] = [];
  const sim = simulation as {
    cost?: { cpuInsns?: string; memBytes?: string };
    events?: unknown[];
    auth?: unknown[];
  };

  if (sim.cost?.cpuInsns) {
    const cpuInsns = BigInt(sim.cost.cpuInsns);
    if (cpuInsns > 100_000_000n) {
      warnings.push('High CPU instruction count — transaction may be slow or exceed ledger limits');
    }
  }

  if (sim.cost?.memBytes) {
    const memBytes = BigInt(sim.cost.memBytes);
    if (memBytes > 5_000_000n) {
      warnings.push('High memory usage — transaction may exceed ledger limits');
    }
  }

  if (sim.events && sim.events.length > 20) {
    warnings.push('Large number of events — review for unexpected side effects');
  }

  return warnings;
}

export class TransactionSimulationService {
  private getRpcServer() {
    return createSorobanRpcServer();
  }

  private getNetworkPassphrase(): string {
    return getStellarNetworkPassphrase();
  }

  async simulateTransaction(
    contractId: string,
    function_: string,
    args: SimulationArg[],
    sourceAccount: string,
    skipCache = false,
  ): Promise<SimulationResult> {
    // Validate contract address
    if (!StrKey.isValidContract(contractId)) {
      throw AppError.badRequest('Invalid contract ID format');
    }

    // Check cache first
    const cacheKey = generateCacheKey(contractId, function_, args, sourceAccount);
    if (!skipCache) {
      const cached = await cacheService.get<SimulationResult>(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    try {
      const server = this.getRpcServer();
      const passphrase = this.getNetworkPassphrase();

      const account = await server.getAccount(sourceAccount);
      const scArgs = args.map(convertArgToScVal);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: function_,
            args: scArgs,
          }),
        )
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if ('error' in simulation) {
        const errorResult: SimulationResult = {
          success: false,
          gasEstimate: '0',
          error: String(simulation.error ?? 'Simulation failed'),
          warnings: [],
          balanceDeltas: [],
          cached: false,
          simulatedAt: new Date().toISOString(),
        };
        return errorResult;
      }

      const warnings = extractWarnings(simulation);
      let returnValue: unknown = undefined;

      if (simulation.result?.retval) {
        try {
          returnValue = scValToNative(simulation.result.retval);
        } catch {
          warnings.push('Could not decode return value');
        }
      }

      const resourceFee = (simulation as { result?: { cost?: { cpuInsns?: string } } }).result?.cost?.cpuInsns ?? '0';

      const result: SimulationResult = {
        success: true,
        gasEstimate: resourceFee,
        resultXdr: simulation.result ? (simulation as { result: { xdr?: string } }).result.xdr : undefined,
        returnValue,
        warnings,
        balanceDeltas: [],
        cached: false,
        simulatedAt: new Date().toISOString(),
      };

      // Cache successful simulations for 30 seconds
      await cacheService.set(cacheKey, result, SIMULATION_CACHE_TTL);

      logger.withContext().info('Transaction simulated successfully', {
        contractId,
        function: function_,
        gasEstimate: result.gasEstimate,
      });

      return result;
    } catch (error) {
      logger.withContext().error('Transaction simulation failed', {
        contractId,
        function: function_,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw AppError.internal(
        `Simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

export const transactionSimulationService = new TransactionSimulationService();
