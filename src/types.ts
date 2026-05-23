export interface ProxySettings {
  proxy_type: string; // "http", "https", "socks4", "socks5", or "ss" (Shadowsocks)
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface TableSortingSettings {
  column: string; // "name", "note", "status"
  direction: string; // "asc" or "desc"
}

export interface BrowserProfile {
  id: string; // UUID of the profile
  name: string;
  browser: string;
  engine?: "botbrowser" | "wayfern" | "cloak" | "camoufox";
  version: string;
  proxy_id?: string; // Reference to stored proxy
  vpn_id?: string; // Reference to stored VPN config
  launch_hook?: string;
  process_id?: number;
  last_launch?: number;
  release_type: string; // "stable" or "nightly"
  camoufox_config?: CamoufoxConfig; // Camoufox configuration
  wayfern_config?: WayfernConfig; // Wayfern configuration
  group_id?: string; // Reference to profile group
  tags?: string[];
  note?: string; // User note
  sync_mode?: SyncMode;
  encryption_salt?: string;
  last_sync?: number; // Timestamp of last successful sync (epoch seconds)
  host_os?: string; // OS where profile was created ("macos", "windows", "linux")
  ephemeral?: boolean;
  extension_group_id?: string;
  proxy_bypass_rules?: string[];
  created_by_id?: string;
  created_by_email?: string;
  dns_blocklist?: string;
  botbrowser_config?: BotBrowserConfig;
  cloak_config?: CloakConfig;
}

export interface BotBrowserConfig {
  executable_path?: string;
  bot_profile_asset_id?: string;
  bot_profile_path?: string;
  extra_args?: string[];
  locale?: string;
  timezone?: string;
  languages?: string;
  noise_seed?: number;
  local_dns?: boolean;
  port_protection?: boolean;
  network_info_override?: boolean;
}

export interface CloakConfig {
  executable_path?: string;
  binary_version?: string;
  binary_sha256?: string;
  fingerprint_seed?: number;
  locale?: string;
  timezone?: string;
  languages?: string;
  extra_args?: string[];
}

export interface SelfHostedTeamUser {
  id: string;
  teamId: string;
  email: string;
  role: "admin" | "member";
  disabledAt?: string | null;
  createdAt: string;
}

export interface TeamBotProfileAsset {
  id: string;
  teamId: string;
  name: string;
  s3Key: string;
  browserMajorVersion?: string | null;
  platform?: string | null;
  createdByUserId: string;
  createdAt: string;
}

export type TeamProfilePermissionLevel = "owner" | "editor" | "viewer";

export interface TeamProfilePermission {
  id: string;
  profileId: string;
  userId: string;
  permission: TeamProfilePermissionLevel;
  user?: SelfHostedTeamUser;
}

export interface TeamProfileRecord {
  id: string;
  teamId: string;
  ownerUserId: string;
  name: string;
  engine: "botbrowser" | "wayfern" | "cloak" | "camoufox";
  botProfileAssetId?: string | null;
  syncMode: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: TeamProfilePermission[];
  botProfileAsset?: TeamBotProfileAsset | null;
  lock?: {
    profileId: string;
    lockedByUserId: string;
    expiresAt: string;
    heartbeatAt: string;
  } | null;
}

export interface TeamAuditLog {
  id: string;
  teamId: string;
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
  user?: SelfHostedTeamUser | null;
}

export type BotBrowserPreflightStatus = "passed" | "failed";

export interface BotBrowserPreflightCheck {
  key:
    | "selfHostedLogin"
    | "engine"
    | "permission"
    | "executable"
    | "botProfile"
    | "lock";
  status: BotBrowserPreflightStatus;
  message: string;
}

export interface BotBrowserPreflightResult {
  canLaunch: boolean;
  checks: BotBrowserPreflightCheck[];
}

export interface Extension {
  id: string;
  name: string;
  file_name: string;
  file_type: string;
  browser_compatibility: string[];
  created_at: number;
  updated_at: number;
  sync_enabled?: boolean;
  last_sync?: number;
  version?: string;
  description?: string;
  author?: string;
  homepage_url?: string;
}

export interface ExtensionGroup {
  id: string;
  name: string;
  extension_ids: string[];
  created_at: number;
  updated_at: number;
  sync_enabled?: boolean;
  last_sync?: number;
}

export type SyncMode = "Disabled" | "Regular" | "Encrypted";

export type SyncStatus = "Disabled" | "Syncing" | "Synced" | "Error";

export interface SyncSettings {
  sync_server_url?: string;
  sync_token?: string;
}

export interface CloudUser {
  id: string;
  email: string;
  plan: string;
  planPeriod: string | null;
  subscriptionStatus: string;
  profileLimit: number;
  cloudProfilesUsed: number;
  proxyBandwidthLimitMb: number;
  proxyBandwidthUsedMb: number;
  proxyBandwidthExtraMb: number;
  teamId?: string;
  teamName?: string;
  teamRole?: string;
}

export interface ProfileLockInfo {
  profileId: string;
  lockedBy: string;
  lockedByEmail: string;
  lockedAt: string;
  expiresAt?: string;
}

export interface CloudAuthState {
  user: CloudUser;
  logged_in_at: string;
}

export interface ProfileSyncStatusEvent {
  profile_id: string;
  status: "disabled" | "syncing" | "synced" | "error" | "pending";
}

export interface ProxyCheckResult {
  ip: string;
  city?: string;
  country?: string;
  country_code?: string;
  timestamp: number;
  is_valid: boolean;
}

export function isSyncEnabled(profile: BrowserProfile): boolean {
  return profile.sync_mode != null && profile.sync_mode !== "Disabled";
}

export const CLOUD_PROXY_ID = "cloud-included-proxy";

export interface StoredProxy {
  id: string;
  name: string;
  proxy_settings: ProxySettings;
  sync_enabled?: boolean;
  last_sync?: number;
  is_cloud_managed?: boolean;
  is_cloud_derived?: boolean;
  geo_country?: string;
  geo_state?: string;
  geo_region?: string;
  geo_city?: string;
  geo_isp?: string;
}

export interface LocationItem {
  code: string;
  name: string;
}

export interface ProfileGroup {
  id: string;
  name: string;
  sync_enabled?: boolean;
  last_sync?: number;
}

export interface GroupWithCount {
  id: string;
  name: string;
  count: number;
  sync_enabled?: boolean;
  last_sync?: number;
}

export interface DetectedProfile {
  browser: string;
  name: string;
  path: string;
  description: string;
  mapped_browser: string;
}

export interface BrowserReleaseTypes {
  stable?: string;
  nightly?: string;
}

export interface AppUpdateInfo {
  current_version: string;
  new_version: string;
  release_notes: string;
  download_url: string;
  is_nightly: boolean;
  published_at: string;
  manual_update_required: boolean;
  release_page_url?: string;
  repo_update: boolean;
}

export interface AppUpdateProgress {
  stage: string; // "downloading", "extracting", "installing", "completed"
  percentage?: number;
  speed?: string; // MB/s
  eta?: string; // estimated time remaining
  message: string;
}

export type CamoufoxOS = "windows" | "macos" | "linux";

export interface CamoufoxConfig {
  proxy?: string;
  screen_max_width?: number;
  screen_max_height?: number;
  screen_min_width?: number;
  screen_min_height?: number;
  geoip?: string | boolean;
  block_images?: boolean;
  block_webrtc?: boolean;
  block_webgl?: boolean;
  executable_path?: string;
  fingerprint?: string; // JSON string of the complete fingerprint config
  randomize_fingerprint_on_launch?: boolean; // Generate new fingerprint on every launch
  os?: CamoufoxOS; // Operating system for fingerprint generation
}

// Extended interface for the advanced fingerprint configuration
export interface CamoufoxFingerprintConfig {
  // Browser behavior
  allowAddonNewTab?: boolean;

  // Navigator properties
  "navigator.userAgent"?: string;
  "navigator.appVersion"?: string;
  "navigator.platform"?: string;
  "navigator.oscpu"?: string;
  "navigator.appCodeName"?: string;
  "navigator.appName"?: string;
  "navigator.product"?: string;
  "navigator.productSub"?: string;
  "navigator.buildID"?: string;
  "navigator.language"?: string;
  "navigator.languages"?: string[];
  "navigator.doNotTrack"?: string;
  "navigator.hardwareConcurrency"?: number;
  "navigator.maxTouchPoints"?: number;
  "navigator.cookieEnabled"?: boolean;
  "navigator.globalPrivacyControl"?: boolean;
  "navigator.onLine"?: boolean;

  // Screen properties
  "screen.height"?: number;
  "screen.width"?: number;
  "screen.availHeight"?: number;
  "screen.availWidth"?: number;
  "screen.availTop"?: number;
  "screen.availLeft"?: number;
  "screen.colorDepth"?: number;
  "screen.pixelDepth"?: number;
  "screen.pageXOffset"?: number;
  "screen.pageYOffset"?: number;

  // Window properties
  "window.outerHeight"?: number;
  "window.outerWidth"?: number;
  "window.innerHeight"?: number;
  "window.innerWidth"?: number;
  "window.screenX"?: number;
  "window.screenY"?: number;
  "window.scrollMinX"?: number;
  "window.scrollMinY"?: number;
  "window.scrollMaxX"?: number;
  "window.scrollMaxY"?: number;
  "window.devicePixelRatio"?: number;
  "window.history.length"?: number;

  // Document properties
  "document.body.clientWidth"?: number;
  "document.body.clientHeight"?: number;
  "document.body.clientTop"?: number;
  "document.body.clientLeft"?: number;

  // Locale and geolocation
  "locale:language"?: string;
  "locale:region"?: string;
  "locale:script"?: string;
  "locale:all"?: string;
  "geolocation:latitude"?: number;
  "geolocation:longitude"?: number;
  "geolocation:accuracy"?: number;
  timezone?: string;

  // Headers
  "headers.Accept-Language"?: string;
  "headers.User-Agent"?: string;
  "headers.Accept-Encoding"?: string;

  // WebRTC
  "webrtc:ipv4"?: string;
  "webrtc:ipv6"?: string;
  "webrtc:localipv4"?: string;
  "webrtc:localipv6"?: string;

  // Battery
  "battery:charging"?: boolean;
  "battery:chargingTime"?: number;
  "battery:dischargingTime"?: number;
  "battery:level"?: number;

  // Fonts
  fonts?: string[];
  "fonts:spacing_seed"?: number;

  // Audio
  "AudioContext:sampleRate"?: number;
  "AudioContext:outputLatency"?: number;
  "AudioContext:maxChannelCount"?: number;

  // Media devices
  "mediaDevices:micros"?: number;
  "mediaDevices:webcams"?: number;
  "mediaDevices:speakers"?: number;
  "mediaDevices:enabled"?: boolean;

  // WebGL
  "webGl:renderer"?: string;
  "webGl:vendor"?: string;
  "webGl:supportedExtensions"?: string[];
  "webGl2:supportedExtensions"?: string[];
  "webGl:contextAttributes"?: {
    alpha?: boolean;
    antialias?: boolean;
    depth?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: string;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    stencil?: boolean;
  };
  "webGl2:contextAttributes"?: {
    alpha?: boolean;
    antialias?: boolean;
    depth?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: string;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    stencil?: boolean;
  };
  "webGl:parameters"?: Record<string, unknown>;
  "webGl2:parameters"?: Record<string, unknown>;
  "webGl:shaderPrecisionFormats"?: Record<string, unknown>;
  "webGl2:shaderPrecisionFormats"?: Record<string, unknown>;

  // Canvas
  "canvas:aaOffset"?: number;
  "canvas:aaCapOffset"?: boolean;

  // Voices
  voices?: {
    isLocalService?: boolean;
    isDefault?: boolean;
    voiceURI?: string;
    name?: string;
    lang?: string;
  }[];
  "voices:blockIfNotDefined"?: boolean;
  "voices:fakeCompletion"?: boolean;
  "voices:fakeCompletion:charsPerSecond"?: number;

  // Other properties
  humanize?: boolean;
  "humanize:maxTime"?: number;
  "humanize:minTime"?: number;
  showcursor?: boolean;
  allowMainWorld?: boolean;
  forceScopeAccess?: boolean;
  enableRemoteSubframes?: boolean;
  disableTheming?: boolean;
  memorysaver?: boolean;
  addons?: string[];
  certificatePaths?: string[];
  certificates?: string[];
  debug?: boolean;
  pdfViewerEnabled?: boolean;
}

export interface CamoufoxLaunchResult {
  id: string;
  processId?: number;
  profilePath?: string;
  url?: string;
}

export type WayfernOS = "windows" | "macos" | "linux" | "android" | "ios";

export interface WayfernConfig {
  proxy?: string;
  screen_max_width?: number;
  screen_max_height?: number;
  screen_min_width?: number;
  screen_min_height?: number;
  geoip?: string | boolean; // For compatibility with shared config form
  block_images?: boolean; // For compatibility with shared config form
  block_webrtc?: boolean;
  block_webgl?: boolean;
  executable_path?: string;
  fingerprint?: string; // JSON string of the complete fingerprint config
  randomize_fingerprint_on_launch?: boolean; // Generate new fingerprint on every launch
  os?: WayfernOS; // Operating system for fingerprint generation
}

// Wayfern fingerprint config - matches the C++ FingerprintData structure
export interface WayfernFingerprintConfig {
  // User agent and platform
  userAgent?: string;
  platform?: string;
  platformVersion?: string;
  brand?: string;
  brandVersion?: string;

  // Hardware
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  deviceMemory?: number;

  // Screen
  screenWidth?: number;
  screenHeight?: number;
  screenAvailWidth?: number;
  screenAvailHeight?: number;
  screenColorDepth?: number;
  screenPixelDepth?: number;
  devicePixelRatio?: number;

  // Window
  windowOuterWidth?: number;
  windowOuterHeight?: number;
  windowInnerWidth?: number;
  windowInnerHeight?: number;
  screenX?: number;
  screenY?: number;

  // Language
  language?: string;
  languages?: string[];

  // Browser features
  doNotTrack?: string;
  cookieEnabled?: boolean;
  webdriver?: boolean;
  pdfViewerEnabled?: boolean;

  // WebGL
  webglVendor?: string;
  webglRenderer?: string;
  webglVersion?: string;
  webglShadingLanguageVersion?: string;
  webglParameters?: string; // JSON string
  webgl2Parameters?: string; // JSON string
  webglShaderPrecisionFormats?: string; // JSON string
  webgl2ShaderPrecisionFormats?: string; // JSON string

  // Timezone and geolocation
  timezone?: string;
  timezoneOffset?: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;

  // Media queries / preferences
  prefersReducedMotion?: boolean;
  prefersDarkMode?: boolean;
  prefersContrast?: string;
  prefersReducedData?: boolean;

  // Color/HDR
  colorGamutSrgb?: boolean;
  colorGamutP3?: boolean;
  colorGamutRec2020?: boolean;
  hdrSupport?: boolean;

  // Audio
  audioSampleRate?: number;
  audioMaxChannelCount?: number;

  // Storage
  localStorage?: boolean;
  sessionStorage?: boolean;
  indexedDb?: boolean;

  // Canvas
  canvasNoiseSeed?: string;

  // Fonts, plugins, mime types (JSON strings)
  fonts?: string; // JSON array string
  plugins?: string; // JSON array string
  mimeTypes?: string; // JSON array string

  // Battery (optional)
  batteryCharging?: boolean;
  batteryChargingTime?: number;
  batteryDischargingTime?: number;
  batteryLevel?: number;

  // Voices
  voices?: string; // JSON array string

  // Vendor info
  vendor?: string;
  vendorSub?: string;
  productSub?: string;

  // Network (optional)
  connectionEffectiveType?: string;
  connectionDownlink?: number;
  connectionRtt?: number;

  // Performance
  performanceMemory?: number;
}

export interface WayfernLaunchResult {
  id: string;
  processId?: number;
  profilePath?: string;
  url?: string;
  cdp_port?: number;
}

// Synchronizer types
export interface SyncFollowerState {
  profile_id: string;
  profile_name: string;
  failed_at_url: string | null;
}

export interface SyncSessionInfo {
  id: string;
  leader_profile_id: string;
  leader_profile_name: string;
  followers: SyncFollowerState[];
}

// Traffic stats types
export interface BandwidthDataPoint {
  timestamp: number;
  bytes_sent: number;
  bytes_received: number;
}

export interface DomainAccess {
  domain: string;
  request_count: number;
  bytes_sent: number;
  bytes_received: number;
  first_access: number;
  last_access: number;
}

export interface TrafficStats {
  proxy_id: string;
  profile_id?: string;
  session_start: number;
  last_update: number;
  total_bytes_sent: number;
  total_bytes_received: number;
  total_requests: number;
  bandwidth_history: BandwidthDataPoint[];
  domains: Record<string, DomainAccess>;
  unique_ips: string[];
}

export interface TrafficSnapshot {
  profile_id?: string;
  session_start: number;
  last_update: number;
  total_bytes_sent: number;
  total_bytes_received: number;
  total_requests: number;
  current_bytes_sent: number;
  current_bytes_received: number;
  recent_bandwidth: BandwidthDataPoint[];
}

export interface FilteredTrafficStats {
  profile_id?: string;
  session_start: number;
  last_update: number;
  total_bytes_sent: number;
  total_bytes_received: number;
  total_requests: number;
  bandwidth_history: BandwidthDataPoint[];
  period_bytes_sent: number;
  period_bytes_received: number;
  period_requests: number;
  domains: Record<string, DomainAccess>;
  unique_ips: string[];
}

// Cookie copy types
export interface UnifiedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  is_secure: boolean;
  is_http_only: boolean;
  same_site: number;
  creation_time: number;
  last_accessed: number;
}

export interface DomainCookies {
  domain: string;
  cookies: UnifiedCookie[];
  cookie_count: number;
}

export interface CookieReadResult {
  profile_id: string;
  browser_type: string;
  domains: DomainCookies[];
  total_count: number;
}

export interface SelectedCookie {
  domain: string;
  name: string;
}

export interface CookieCopyRequest {
  source_profile_id: string;
  target_profile_ids: string[];
  selected_cookies: SelectedCookie[];
}

export interface CookieCopyResult {
  target_profile_id: string;
  cookies_copied: number;
  cookies_replaced: number;
  errors: string[];
}

// Proxy import/export types
export interface ProxyExportData {
  version: string;
  proxies: ExportedProxy[];
  exported_at: string;
  source: string;
}

export interface ExportedProxy {
  name: string;
  type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyImportResult {
  imported_count: number;
  skipped_count: number;
  errors: string[];
  proxies: StoredProxy[];
}

export interface ParsedProxyLine {
  proxy_type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  original_line: string;
}

export type ProxyParseResult =
  | ({ status: "parsed" } & ParsedProxyLine)
  | { status: "ambiguous"; line: string; possible_formats: string[] }
  | { status: "invalid"; line: string; reason: string };

// VPN types
export type VpnType = "WireGuard";

export interface VpnConfig {
  id: string;
  name: string;
  vpn_type: VpnType;
  config_data: string; // Raw config content (may be empty in list view)
  created_at: number;
  last_used?: number;
  sync_enabled?: boolean;
  last_sync?: number;
}

export interface VpnImportResult {
  success: boolean;
  vpn_id?: string;
  vpn_type?: VpnType;
  name: string;
  error?: string;
}

export interface VpnStatus {
  connected: boolean;
  vpn_id: string;
  connected_at?: number;
  bytes_sent?: number;
  bytes_received?: number;
  last_handshake?: number;
}

// Browser engine discriminator string. Mirrors `BrowserProfile.engine` but as a
// non-optional union for code paths that have already resolved which engine to
// use (e.g. the create-profile wizard, deep-link routing).
export type BrowserTypeString = "botbrowser" | "camoufox" | "cloak" | "wayfern";

// Mirrors `src-tauri/src/self_hosted_auth.rs::SelfHostedUser` with serde
// renames applied. `role` is `string` (not a literal union) because the server
// may add new roles over time.
export interface SelfHostedUser {
  id: string;
  email: string;
  role: string;
  teamId: string;
  teamName?: string | null;
  prefix?: string | null;
  teamPrefix?: string | null;
}

// Mirrors `src-tauri/src/self_hosted_auth.rs::SelfHostedAuthState`.
export interface SelfHostedAuthState {
  server_url: string;
  user: SelfHostedUser;
}
