/**
 * Environment Configuration for Downloader Project
 * Centralized configuration management
 */

// Environment detection
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isProduction = !isDevelopment;

// Base configuration object
const environment = {
    // Environment info
    isDev: isDevelopment,
    isProd: isProduction,
    mode: isDevelopment ? 'development' : 'production',

    // API Configuration
    api: {
        // PHP backend router endpoint
        baseUrl: isDevelopment
            ? 'https://api.freedub.io/api/v1'
            : 'https://api.freedub.io/api/v1',

        // YouTube Stream API (direct download service)
        // Uses environment variables from .env.production or .env.test
        youtubeStreamApi: {
            baseUrl: import.meta.env.VITE_YOUTUBE_STREAM_API_BASE_URL || 'https://hub.y2mp3.co',
            endpoint: import.meta.env.VITE_YOUTUBE_STREAM_API_ENDPOINT || '/',
        },

        // Search endpoint (specific for search functionality)
        searchEndpoint: '/index.php',

        // Request timeouts (in milliseconds)
        // Request timeouts (in milliseconds)
        timeout: {
            default: 15000,
            licenseValidate: 12000,
            polling_timeout: 1000, // 1 second for progress polling requests
            extract: 1800000, // 30 minutes for extract operations
            searchTitle: 20000,
            playlist: 25000,
            convert: 20000,
            checkTask: 30000000,
            suggest: 7000,
            decode: 60000, // 60 seconds for URL decryption
            multifileStart: 1500000, 
            extractV2_stream: 2000000,
            streamDownload: 1800000, // 30 minutes for stream download to RAM (no timeout issues)
            prepare: 60000,          // 60 seconds for prepare API
            transcribe: 300000,      // 5 minutes for transcribe API
            createProject: 1800000,      // 30 minutes — POST /projects backend resolves media URLs
            subtitleCreate: 30000,       // POST /subtitle — async, returns 202 immediately
            subtitlePollInterval: 3000,  // 3s between GET /subtitle status polls
            projectUpdate: 30000,        // PATCH project/subtitle (auto-save)
            export: 30000,               // GET /subtitle/{id}/export (srt/vtt text)
            proVoices: 10000,        // 10 seconds for pro voices list
            ttsSubmit: 30000,        // 30 seconds for TTS submit
            ttsPollInterval: 2000,   // 2 seconds between TTS status polls
            mediaPollInterval: 3000,  // 3 seconds between media processing polls
            renderPollInterval: 3000, // 3 seconds between render status polls
            upgradePollInterval: 1000, // 1 second between upgrade status polls
            translate: 60000,        // 60 seconds for translate API
            upload: 30000,           // 30 seconds for file upload
            render: 30000,           // 30 seconds for render submit
            downloadExtract: 60000,
            downloadPollInterval: 1000,
            downloadPollRequest: 15000,
            downloadFallback: 40000,
            downloadGlobalTimeout: 1800000,
            downloadPollRetryDelay: 1000,
        }
    },

    // CAPTCHA Configuration
    captcha: {
        // Default provider: "cloudflare" or "google"
        provider: 'cloudflare',

        // Cloudflare Turnstile configuration
        cloudflare: {
            siteKey: '1x00000000000000000000AA',
            enabled: true
        },

        // Google reCAPTCHA configuration
        google: {
            siteKey: 'avv',
            enabled: true
        }
    },

    // Application Configuration
    app: {
        // Identifier for multi-site backend configs
        webName: 'default',

        // Application metadata
        name: 'Video Downloader',
        version: '1.0.0'
    },

    // Feature flags
    features: {
        enableSuggestions: true,
        enablePlaylistSupport: true,
        enableCaptcha: true,
        enableDebugLogging: isDevelopment,
        // When true: show placeholder + bounce animation if no storage
        // When false: auto-fill page defaults if no storage
        isValidateNoStorageFormat: false
    },

    // Download Limits and Thresholds
    limits: {
        // iOS RAM download threshold (150MB = 157,286,400 bytes)
        // Files larger than this on iOS use progressUrl polling instead of direct stream
        iosStreamMaxSize: 150 * 1024 * 1024, // 157,286,400 bytes

        // Large file threshold (500MB = 524,288,000 bytes)
        // Files larger than this on any platform use progressUrl polling for better progress tracking
        largeFilePollingThreshold: 500 * 1024 * 1024, // 524,288,000 bytes
    },

    // Development-specific settings
    dev: {
        enableVerboseLogging: isDevelopment,
        mockApiCalls: false,
        bypassCaptcha: isDevelopment
    }
};

/**
 * Get API base URL with fallback
 * @returns {string} API base URL
 */
export function getApiBaseUrl() {
    return environment.api.baseUrl;
}

/**
 * Get complete API endpoint URL
 * @param {string} endpoint - API endpoint path
 * @returns {string} Complete URL
 */
export function getApiUrl(endpoint) {
    const baseUrl = getApiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${baseUrl}${cleanEndpoint}`;
}

/**
 * Get search endpoint URL
 * @returns {string} Search endpoint URL
 */
export function getSearchUrl() {
    return getApiUrl(environment.api.searchEndpoint);
}

/**
 * Get YouTube Stream API base URL
 * @returns {string} YouTube Stream API base URL
 */
export function getYouTubeStreamApiUrl() {
    return environment.api.youtubeStreamApi.baseUrl;
}

/**
 * Get YouTube Stream API endpoint
 * @returns {string} YouTube Stream API endpoint path
 */
export function getYouTubeStreamApiEndpoint() {
    return environment.api.youtubeStreamApi.endpoint;
}

/**
 * Get CAPTCHA configuration for current provider
 * @returns {Object} CAPTCHA config
 */
export function getCaptchaConfig() {
    const provider = environment.captcha.provider;
    return {
        provider,
        config: environment.captcha[provider],
        enabled: environment.features.enableCaptcha
    };
}

/**
 * Check if feature is enabled
 * @param {string} featureName - Name of feature to check
 * @returns {boolean} Whether feature is enabled
 */
export function isFeatureEnabled(featureName) {
    return environment.features[featureName] || false;
}

/**
 * Get request timeout for specific operation
 * @param {string} operation - Operation name (extract, search, etc.)
 * @returns {number} Timeout in milliseconds
 */
export function getTimeout(operation) {
    return environment.api.timeout[operation] || environment.api.timeout.default;
}

/**
 * Get iOS stream max size threshold (150MB)
 * Files larger than this on iOS will use progressUrl polling instead of direct stream
 * @returns {number} Max size in bytes (157,286,400)
 */
export function getIOSStreamMaxSize() {
    return environment.limits.iosStreamMaxSize;
}

/**
 * Get large file polling threshold (500MB)
 * Files larger than this on any platform will use progressUrl polling for better progress tracking
 * @returns {number} Max size in bytes (524,288,000)
 */
export function getLargeFilePollingThreshold() {
    return environment.limits.largeFilePollingThreshold;
}

/**
 * Log environment info (development only)
 */
export function logEnvironmentInfo() {
    if (environment.dev.enableVerboseLogging) {
    }
}

// Auto-log on import in development
if (isDevelopment) {
    logEnvironmentInfo();
}

// Export main environment object
export default environment;

// Named exports for convenience
export const {
    api: apiConfig,
    captcha: captchaConfig,
    app: appConfig,
    features: featureFlags,
    limits: downloadLimits,
    dev: devConfig
} = environment;
