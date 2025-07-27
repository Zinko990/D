const axios = require('axios');
const ethers = require('ethers');
const dotenv = require('dotenv');
const readline = require('readline');

dotenv.config();

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m"
};

async function buildFallbackProvider(rpcUrls, chainId, name) {
  const provider = new ethers.JsonRpcProvider(rpcUrls[0], { chainId, name });
  return {
    getProvider: async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await provider.getBlockNumber();
          return provider;
        } catch (e) {
          if (e.code === 'UNKNOWN_ERROR' && e.error && e.error.code === -32603) {
            console.log(`${colors.yellow}[⚠] RPC busy, retrying ${i + 1}/3...${colors.reset}`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw e;
        }
      }
      throw new Error('All RPC retries failed');
    }
  };
}

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  countdown: (msg) => process.stdout.write(`\r${colors.blue}[⏰] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`     PharosV2 Auto Bot - Swap & LP           `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

const PHAROS_CHAIN_ID = 688688;
const PHAROS_RPC_URLS = ['https://testnet.dplabs-internal.com'];

const TOKENS = {
  PHRS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Example USDT address (testnet မှာ ပြောင်းရမယ်)
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // Example USDC address (testnet မှာ ပြောင်းရမယ်)
};

const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Example Uniswap V2 router (testnet မှာ ပြောင်းရမယ်)

async function approveToken(wallet, tokenAddress, spender, amount) {
  logger.step(`Approving ${ethers.formatUnits(amount, 6)} tokens for ${spender.slice(0, 6)}...`);
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const tx = await tokenContract.approve(spender, amount);
    await tx.wait();
    logger.success('Token approval successful!');
    return true;
  } catch (e) {
    logger.error(`Token approval failed: ${e.message}`);
    throw e;
  }
}

async function executeSwap(wallet, fromToken, toToken, amount) {
  logger.step(`Swapping ${ethers.formatUnits(amount, 6)} ${fromToken.slice(0, 6)} to ${toToken.slice(0, 6)}...`);
  try {
    const router = new ethers.Contract(UNISWAP_ROUTER, [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
    ], wallet);
    
    await approveToken(wallet, fromToken, UNISWAP_ROUTER, amount);
    const path = [fromToken, toToken];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes deadline
    const amountOutMin = 0; // Set a proper slippage tolerance in production
    const tx = await router.swapExactTokensForTokens(amount, amountOutMin, path, wallet.address, deadline, { gasLimit: 300000 });
    await tx.wait();
    logger.success(`Swap successful! TX Hash: ${tx.hash}`);
    return true;
  } catch (e) {
    logger.error(`Swap failed: ${e.message}`);
    throw e;
  }
}

async function addLiquidity(wallet, tokenA, tokenB, amountA, amountB) {
  logger.step(`Adding liquidity ${ethers.formatUnits(amountA, 6)} ${tokenA.slice(0, 6)} and ${ethers.formatUnits(amountB, 6)} ${tokenB.slice(0, 6)}...`);
  try {
    const router = new ethers.Contract(UNISWAP_ROUTER, [
      'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)'
    ], wallet);
    
    await approveToken(wallet, tokenA, UNISWAP_ROUTER, amountA);
    await approveToken(wallet, tokenB, UNISWAP_ROUTER, amountB);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes deadline
    const tx = await router.addLiquidity(tokenA, tokenB, amountA, amountB, 0, 0, wallet.address, deadline, { gasLimit: 400000 });
    await tx.wait();
    logger.success(`Liquidity added successfully! TX Hash: ${tx.hash}`);
    return true;
  } catch (e) {
    logger.error(`Add liquidity failed: ${e.message}`);
    throw e;
  }
}

function loadPrivateKeys() {
  const keys = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY_${i}`]) {
    const pk = process.env[`PRIVATE_KEY_${i}`];
    if (pk.startsWith('0x') && pk.length === 66) {
      keys.push(pk);
    } else {
      logger.warn(`Invalid PRIVATE_KEY_${i} in .env, skipping...`);
    }
    i++;
  }
  return keys;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

(async () => {
  logger.banner();
  const fallbackProvider = await buildFallbackProvider(PHAROS_RPC_URLS, PHAROS_CHAIN_ID, 'pharos');
  const provider = await fallbackProvider.getProvider();
  const privateKeys = loadPrivateKeys();

  if (privateKeys.length === 0) {
    logger.error('No valid private keys found in .env. Please add PRIVATE_KEY_1, PRIVATE_KEY_2, etc.');
    process.exit(1);
  }
  
  logger.info(`${privateKeys.length} wallet(s) loaded from .env file.\n`);

  const swapCountStr = await question(`${colors.cyan}Enter the number of swaps (for each wallet): ${colors.reset}`);
  const numberOfSwaps = parseInt(swapCountStr);
  const lpCountStr = await question(`${colors.cyan}Enter the number of liquidity additions (for each wallet): ${colors.reset}`);
  const numberOfLP = parseInt(lpCountStr);
  const swapAmountStr = await question(`${colors.cyan}Enter swap amount (in wei): ${colors.reset}`);
  const swapAmount = ethers.parseUnits(swapAmountStr, 6); // Assuming 6 decimals for USDT/USDC
  const lpAmountAStr = await question(`${colors.cyan}Enter liquidity amount for Token A (in wei): ${colors.reset}`);
  const lpAmountA = ethers.parseUnits(lpAmountAStr, 6);
  const lpAmountBStr = await question(`${colors.cyan}Enter liquidity amount for Token B (in wei): ${colors.reset}`);
  const lpAmountB = ethers.parseUnits(lpAmountBStr, 6);
  console.log('\n');

  while (true) {
    for (const [index, privateKey] of privateKeys.entries()) {
      try {
        const wallet = new ethers.Wallet(privateKey, provider);
        console.log('----------------------------------------------------------------');
        logger.success(`Processing Wallet ${index + 1}/${privateKeys.length}: ${wallet.address}`);
        console.log('----------------------------------------------------------------');

        if (!isNaN(numberOfSwaps) && numberOfSwaps > 0) {
          for (let i = 0; i < numberOfSwaps; i++) {
            logger.step(`Starting Swap #${i + 1} of ${numberOfSwaps}`);
            try {
              await executeSwap(wallet, TOKENS.USDT, TOKENS.PHRS, swapAmount); // Example: USDT to PHRS
            } catch (e) {
              logger.error(`Swap #${i + 1} failed: ${e.message}`);
            }
            if (i < numberOfSwaps - 1) {
              logger.info('Waiting a moment before the next swap...');
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          logger.success('Swap operations completed for this wallet!');
        } else if (index === 0) {
          logger.warn('Invalid swap count, skipping swaps.');
        }

        if (!isNaN(numberOfLP) && numberOfLP > 0) {
          for (let i = 0; i < numberOfLP; i++) {
            logger.step(`Starting Liquidity Addition #${i + 1} of ${numberOfLP}`);
            try {
              await addLiquidity(wallet, TOKENS.USDT, TOKENS.USDC, lpAmountA, lpAmountB); // Example: USDT and USDC
            } catch (e) {
              logger.error(`Liquidity Addition #${i + 1} failed: ${e.message}`);
            }
            if (i < numberOfLP - 1) {
              logger.info('Waiting a moment before the next liquidity addition...');
              await new Promise(r => setTimeout(r, 5000));
            }
          }
          logger.success('Liquidity addition operations completed for this wallet!');
        } else if (index === 0) {
          logger.warn('Invalid liquidity addition count, skipping.');
        }

        logger.success(`All tasks finished for wallet ${wallet.address}\n`);

      } catch (err) {
        logger.error(`A critical error occurred while processing wallet ${index + 1}: ${err.message}`);
      }

      if (index < privateKeys.length - 1) {
        logger.info(`Waiting 10 seconds before starting the next wallet...`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    logger.step('All wallets have been processed for this cycle.');
    await showCountdown();
  }
})();

async function showCountdown() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return new Promise(resolve => {
    const interval = setInterval(() => {
      const remaining = tomorrow - new Date();
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      logger.countdown(`Next cycle in ${hours}h ${minutes}m ${seconds}s`);
      if (remaining <= 0) {
        clearInterval(interval);
        process.stdout.write('\n');
        resolve();
      }
    }, 1000);
  });
}
