// Calmview stand-in for the Google IMA SDK (ima3.js). Video players ask it for ads; this one always
// answers "no ads available", so the player goes straight to the video instead of breaking.
(function () {
  "use strict";
  var w = window;
  if (w.google && w.google.ima && w.google.ima.__hush) return;
  function later(fn) { setTimeout(fn, 0); }
  function Emitter() { this._l = {}; }
  Emitter.prototype.addEventListener = function (t, fn, _c, ctx) {
    var list = Array.isArray(t) ? t : [t];
    for (var i = 0; i < list.length; i++) (this._l[list[i]] = this._l[list[i]] || []).push({ fn: fn, ctx: ctx });
  };
  Emitter.prototype.removeEventListener = function (t, fn) {
    var list = Array.isArray(t) ? t : [t];
    for (var i = 0; i < list.length; i++) this._l[list[i]] = (this._l[list[i]] || []).filter(function (x) { return x.fn !== fn; });
  };
  Emitter.prototype._emit = function (t, ev) {
    var list = (this._l[t] || []).slice();
    for (var i = 0; i < list.length; i++) { try { list[i].fn.call(list[i].ctx || this, ev); } catch (e) { setTimeout(function () { throw e; }); } }
  };
  function inherit(C) { C.prototype = Object.create(Emitter.prototype); C.prototype.constructor = C; return C; }

  var AdEventType = {};
  ["AD_BREAK_READY", "AD_BUFFERING", "AD_CAN_PLAY", "AD_METADATA", "AD_PROGRESS", "ALL_ADS_COMPLETED", "CLICK", "COMPLETE", "CONTENT_PAUSE_REQUESTED", "CONTENT_RESUME_REQUESTED", "DURATION_CHANGE", "EXPANDED_CHANGED", "FIRST_QUARTILE", "IMPRESSION", "INTERACTION", "LINEAR_CHANGED", "LINEAR_CHANGE", "LOADED", "LOG", "MIDPOINT", "PAUSED", "RESUMED", "SKIPPABLE_STATE_CHANGED", "SKIPPED", "STARTED", "THIRD_QUARTILE", "USER_CLOSE", "VIDEO_CLICKED", "VIDEO_ICON_CLICKED", "VIEWABLE_IMPRESSION", "VOLUME_CHANGED", "VOLUME_MUTED", "AD_BREAK_FETCH_ERROR", "AD_BREAK_STARTED", "AD_BREAK_ENDED"].forEach(function (k) {
    AdEventType[k] = k.toLowerCase().replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
  });
  AdEventType.CONTENT_PAUSE_REQUESTED = "contentPauseRequested";
  AdEventType.CONTENT_RESUME_REQUESTED = "contentResumeRequested";
  AdEventType.ALL_ADS_COMPLETED = "allAdsCompleted";

  function AdEvent(type) { this.type = type; }
  AdEvent.Type = AdEventType;
  AdEvent.prototype.getAd = function () { return null; };
  AdEvent.prototype.getAdData = function () { return {}; };

  function AdError(message) { this.message = message; this.errorCode = 1009; this.type = "adLoadError"; }
  AdError.prototype.getErrorCode = function () { return this.errorCode; };
  AdError.prototype.getVastErrorCode = function () { return 303; };
  AdError.prototype.getMessage = function () { return this.message; };
  AdError.prototype.getType = function () { return this.type; };
  AdError.prototype.getInnerError = function () { return null; };
  AdError.prototype.toString = function () { return "AdError " + this.errorCode + ": " + this.message; };
  AdError.ErrorCode = { VAST_EMPTY_RESPONSE: 1009, UNKNOWN_ERROR: 900 };
  AdError.Type = { AD_LOAD: "adLoadError", AD_PLAY: "adPlayError" };

  function AdErrorEvent(error, ctx) { this.type = "adError"; this._e = error; this._c = ctx; }
  AdErrorEvent.Type = { AD_ERROR: "adError" };
  AdErrorEvent.prototype.getError = function () { return this._e; };
  AdErrorEvent.prototype.getUserRequestContext = function () { return this._c || {}; };

  var AdsManager = inherit(function AdsManager() { Emitter.call(this); this._vol = 1; });
  ["init", "pause", "resume", "resize", "skip", "stop", "collapse", "expand", "focus", "clicked", "discardAdBreak", "updateAdsRenderingSettings", "configureAdsManager", "requestNextAdBreak", "setAutoPlayAdBreaks", "destroy"].forEach(function (m) {
    AdsManager.prototype[m] = function () {};
  });
  AdsManager.prototype.start = function () {
    var self = this;
    later(function () {
      self._emit(AdEventType.CONTENT_RESUME_REQUESTED, new AdEvent(AdEventType.CONTENT_RESUME_REQUESTED));
      self._emit(AdEventType.ALL_ADS_COMPLETED, new AdEvent(AdEventType.ALL_ADS_COMPLETED));
    });
  };
  AdsManager.prototype.getCuePoints = function () { return []; };
  AdsManager.prototype.getRemainingTime = function () { return 0; };
  AdsManager.prototype.getAdSkippableState = function () { return false; };
  AdsManager.prototype.getVolume = function () { return this._vol; };
  AdsManager.prototype.setVolume = function (v) { this._vol = v; };
  AdsManager.prototype.isCustomClickTrackingUsed = function () { return false; };
  AdsManager.prototype.isCustomPlaybackUsed = function () { return false; };

  function AdsManagerLoadedEvent(ctx) { this.type = "adsManagerLoaded"; this._c = ctx; }
  AdsManagerLoadedEvent.Type = { ADS_MANAGER_LOADED: "adsManagerLoaded" };
  AdsManagerLoadedEvent.prototype.getAdsManager = function () { return new AdsManager(); };
  AdsManagerLoadedEvent.prototype.getUserRequestContext = function () { return this._c || {}; };

  function ImaSdkSettings() { this._s = {}; }
  ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
  ["setAutoPlayAdBreaks", "setCompanionBackfill", "setCookiesEnabled", "setDisableCustomPlaybackForIOS10Plus", "setFeatureFlags", "setLocale", "setNumRedirects", "setPlayerType", "setPlayerVersion", "setPpid", "setSessionId", "setVpaidAllowed", "setVpaidMode", "setDisableFlashAds"].forEach(function (m) {
    ImaSdkSettings.prototype[m] = function (v) { this._s[m.slice(3)] = v; };
    ImaSdkSettings.prototype["get" + m.slice(3)] = function () { return this._s[m.slice(3)]; };
  });
  ImaSdkSettings.prototype.isCookiesEnabled = function () { return true; };
  ImaSdkSettings.prototype.isVpaidAdapter = function () { return false; };
  var settings = new ImaSdkSettings();

  var AdsLoader = inherit(function AdsLoader() { Emitter.call(this); });
  AdsLoader.prototype.requestAds = function (_req, ctx) {
    var self = this;
    later(function () { self._emit("adError", new AdErrorEvent(new AdError("No ads available"), ctx)); });
  };
  AdsLoader.prototype.contentComplete = function () {};
  AdsLoader.prototype.destroy = function () {};
  AdsLoader.prototype.getSettings = function () { return settings; };
  AdsLoader.prototype.getVersion = function () { return "3.0.0"; };

  function AdDisplayContainer() {}
  AdDisplayContainer.prototype.initialize = function () {};
  AdDisplayContainer.prototype.destroy = function () {};

  function AdsRequest() {}
  ["setAdWillAutoPlay", "setAdWillPlayMuted", "setContinuousPlayback"].forEach(function (m) { AdsRequest.prototype[m] = function () {}; });
  function AdsRenderingSettings() {}
  function CompanionAdSelectionSettings() {}
  CompanionAdSelectionSettings.CreativeType = { ALL: "All", FLASH: "Flash", IMAGE: "Image" };
  CompanionAdSelectionSettings.ResourceType = { ALL: "All", HTML: "Html", IFRAME: "IFrame", STATIC: "Static" };
  CompanionAdSelectionSettings.SizeCriteria = { IGNORE: "IgnoreSize", SELECT_EXACT_MATCH: "SelectExactMatch", SELECT_NEAR_MATCH: "SelectNearMatch" };

  w.google = w.google || {};
  w.google.ima = {
    __hush: true,
    AdDisplayContainer: AdDisplayContainer,
    AdError: AdError,
    AdErrorEvent: AdErrorEvent,
    AdEvent: AdEvent,
    AdsLoader: AdsLoader,
    AdsManager: AdsManager,
    AdsManagerLoadedEvent: AdsManagerLoadedEvent,
    AdsRenderingSettings: AdsRenderingSettings,
    AdsRequest: AdsRequest,
    CompanionAdSelectionSettings: CompanionAdSelectionSettings,
    ImaSdkSettings: ImaSdkSettings,
    OmidAccessMode: { DOMAIN: "domain", FULL: "full", LIMITED: "limited" },
    OmidVerificationVendor: {},
    UiElements: { AD_ATTRIBUTION: "adAttribution", COUNTDOWN: "countdown" },
    UniversalAdIdInfo: function () {},
    ViewMode: { FULLSCREEN: "fullscreen", NORMAL: "normal" },
    VERSION: "3.0.0",
    settings: settings,
  };
})();
