// backend/data/voicesPreset.js
//
// The Voices preset — ~200 public X/Twitter accounts across six
// categories that drive the "Voices" tab on IronFeed. Governance can
// rotate any of these via a future PromptUpdate proposal; this file
// is the seed list we ship with.
//
// Category tags surface in the UI so users can filter the Voices feed
// down to just Crypto, just Politics, etc. if they want.
//
// Handles are stored without the leading @ and must match the Twitter
// handle regex [A-Za-z0-9_]{1,15}.

const POLITICS = [
  "POTUS", "VP", "SenSchumer", "SenateGOP", "HouseGOP", "HouseDemocrats",
  "AOC", "RandPaul", "SenWarren", "tedcruz", "SenSanders", "PressSec",
  "StateDept", "WhiteHouse", "RepMTG", "SecBlinken", "UN", "EmmanuelMacron",
  "Keir_Starmer", "NATO", "EUCouncil", "RishiSunak", "JustinTrudeau",
  "AlboMP", "narendramodi", "ForeignOffice", "SecYellen", "SpeakerJohnson",
  "JoeBiden", "realDonaldTrump", "GovRonDeSantis", "Mike_Pence",
  "MichelleObama",
];

const CRYPTO = [
  "cobie", "0xMert_", "gainzy222", "trader1sz", "ansemf", "icebergy_",
  "zachxbt", "Loopifyyy", "AltcoinGordon", "jesse_pollak", "CryptoHayes",
  "hasufl", "RyanSAdams", "punk9059", "tayvano_", "VitalikButerin",
  "cz_binance", "saylor", "aantonop", "TheCryptoLark", "PeterLBrandt",
  "PeterSchiff", "balajis", "rager_btc", "LynAldenContact", "MustStopMurad",
  "MoonOverlord", "WClementeIII", "MacroCharts", "Bitboy_Crypto",
  "RaoulGMI", "nic__carter", "pete_rizzo_",
];

const TRENDS = [
  "MrBeast", "KimKardashian", "justinbieber", "rihanna", "Oprah",
  "kanyewest", "ArianaGrande", "BarackObama", "Cristiano", "neymarjr",
  "KingJames", "KylieJenner", "Drake", "SHAQ", "Eminem", "Beyonce",
  "taylorswift13", "ladygaga", "pitbull", "aliciakeys", "mariahcarey",
  "BrunoMars", "JLo", "SnoopDogg", "50cent", "iamsrk", "priyankachopra",
  "Ibra_official", "rogerfederer", "NAVIEsports", "TeamLiquid",
  "100Thieves", "FaZeClan",
];

const WEB3 = [
  "NEARProtocol", "aave", "Uniswap", "ensdomains", "OptimismFND",
  "Arbitrum", "base", "avax", "0xPolygon", "ethereum", "solana",
  "cosmos", "chainlink", "Aptos_Network", "SuiNetwork", "StarkWareLtd",
  "zksync", "LensProtocol", "farcaster_xyz", "LidoFinance",
  "compoundfinance", "MakerDAO", "dYdX", "CurveFinance", "friendtech",
  "SnapshotLabs", "gitcoin", "Optimism", "Starknet", "CelestiaOrg",
  "fuel_network", "Ronin_Network", "worldcoin",
];

const STOCK = [
  "jimcramer", "GoldmanSachs", "CNBC", "WSJ", "MorganStanley", "Reuters",
  "federalreserve", "SECGov", "Forbes", "FT", "BillAckman", "RayDalio",
  "charliebilello", "tradingview", "elerianm", "NorthmanTrader",
  "ReformedBroker", "alphatrends", "markets", "CNBCnow", "zerohedge",
  "markflowchatter", "finblr", "Investing", "TheRealCMT", "jpmorgan",
  "BlackRock", "Vanguard_Group", "Fidelity", "BankofAmerica", "Citi",
  "MorningstarInc", "bloombergtv",
];

const TECH = [
  "OpenAI", "sama", "elonmusk", "paulg", "naval", "tim_cook",
  "satyanadella", "sundarpichai", "AndrewYNg", "lexfridman",
  "karpathy", "GoogleDeepMind", "NVIDIAAI", "Microsoft", "AnthropicAI",
  "perplexity_ai", "LangChainAI", "huggingface", "pmarca", "reidhoffman",
  "vkhosla", "fchollet", "DrJimFan", "demishassabis", "emollick",
  "geoffreyhinton", "ylecun", "JeffDean", "amasad", "levie", "a16z",
  "sequoia", "paulgraham",
];

const VOICES_CATEGORIES = {
  politics: POLITICS,
  crypto:   CRYPTO,
  trends:   TRENDS,
  web3:     WEB3,
  stock:    STOCK,
  tech:     TECH,
};

// Flat list + reverse map for fast category lookup when we merge
// per-handle timelines. Dedupes lowercased — a handle only belongs to
// the first category it appears in.
const HANDLE_TO_CATEGORY = new Map();
const FLAT_HANDLES = [];
for (const [cat, arr] of Object.entries(VOICES_CATEGORIES)) {
  for (const h of arr) {
    const k = h.toLowerCase();
    if (!HANDLE_TO_CATEGORY.has(k)) {
      HANDLE_TO_CATEGORY.set(k, cat);
      FLAT_HANDLES.push(h);
    }
  }
}

module.exports = {
  VOICES_CATEGORIES,
  VOICES_PRESET_HANDLES: FLAT_HANDLES,
  HANDLE_TO_CATEGORY,
  categoryOf(handle) {
    if (!handle) return null;
    return HANDLE_TO_CATEGORY.get(String(handle).toLowerCase()) || null;
  },
};
