// Fingerprint protection script - injected into page context
// Normalize common fingerprinting vectors with stable, low-entropy values.

(function() {
  'use strict';

  if (location && location.protocol === 'file:') {
    return;
  }

  function quantize(value, step) {
    if (!value || !step) return value;
    return Math.round(value / step) * step;
  }

  function getDescriptor(obj, prop) {
    if (!obj) return null;
    const own = Object.getOwnPropertyDescriptor(obj, prop);
    if (own) return own;
    const proto = Object.getPrototypeOf(obj);
    if (!proto) return null;
    return Object.getOwnPropertyDescriptor(proto, prop);
  }

  function defineValue(obj, prop, value) {
    const descriptor = getDescriptor(obj, prop);
    const enumerable = descriptor ? descriptor.enumerable : true;
    const configurable = descriptor ? descriptor.configurable : true;

    try {
      Object.defineProperty(obj, prop, {
        get: () => value,
        configurable,
        enumerable
      });
      return;
    } catch (e) {
      // Fallback to prototype
    }

    try {
      const proto = Object.getPrototypeOf(obj);
      if (!proto) return;
      Object.defineProperty(proto, prop, {
        get: () => value,
        configurable: true,
        enumerable
      });
    } catch (e) {
      // Ignore if property cannot be redefined
    }
  }

  function defineGetter(obj, prop, getter) {
    const descriptor = getDescriptor(obj, prop);
    const enumerable = descriptor ? descriptor.enumerable : true;
    const configurable = descriptor ? descriptor.configurable : true;

    try {
      Object.defineProperty(obj, prop, {
        get: getter,
        configurable,
        enumerable
      });
      return;
    } catch (e) {
      // Fallback to prototype
    }

    try {
      const proto = Object.getPrototypeOf(obj);
      if (!proto) return;
      Object.defineProperty(proto, prop, {
        get: getter,
        configurable: true,
        enumerable
      });
    } catch (e) {
      // Ignore if property cannot be redefined
    }
  }

  if (window.__vitaminFingerprintProtectionApplied) {
    return;
  }
  window.__vitaminFingerprintProtectionApplied = true;

  const ua = navigator.userAgent || '';
  const normalizedUserAgent = ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const chromeMatch = normalizedUserAgent.match(/Chrome\/(\d+)\./);
  const chromeMajor = chromeMatch ? chromeMatch[1] : '120';
  const chromeFullMatch = normalizedUserAgent.match(/Chrome\/([0-9.]+)/);
  const chromeFull = chromeFullMatch ? chromeFullMatch[1] : chromeMajor + '.0.0.0';

  let platform = 'Win32';
  let uaPlatform = 'Windows';
  let platformVersion = '10.0.0';
  if (/Mac/i.test(normalizedUserAgent)) {
    platform = 'MacIntel';
    uaPlatform = 'macOS';
    const macMatch = normalizedUserAgent.match(/Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/);
    if (macMatch) {
      platformVersion = `${macMatch[1]}.${macMatch[2]}.${macMatch[3] || 0}`;
    }
  } else if (/Linux/i.test(normalizedUserAgent)) {
    platform = 'Linux x86_64';
    uaPlatform = 'Linux';
    platformVersion = '0.0.0';
  }

  const profile = {
    platform: platform,
    vendor: 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorDepth: 24,
    pixelDepth: 24,
    userAgent: normalizedUserAgent,
    appVersion: normalizedUserAgent.replace(/^Mozilla\//, ''),
    appName: 'Netscape',
    appCodeName: 'Mozilla',
    product: 'Gecko',
    productSub: '20030107',
    vendorSub: ''
  };

  let screenProfile = { width: 1920, height: 1080 };

  // Spoof navigator properties
  try {
    defineValue(navigator, 'hardwareConcurrency', profile.hardwareConcurrency);
    defineValue(navigator, 'deviceMemory', profile.deviceMemory);
    defineValue(navigator, 'maxTouchPoints', profile.maxTouchPoints);
    defineValue(navigator, 'platform', profile.platform);
    defineValue(navigator, 'vendor', profile.vendor);
    defineValue(navigator, 'language', profile.language);
    defineValue(navigator, 'languages', profile.languages);
    defineValue(navigator, 'userAgent', profile.userAgent);
    defineValue(navigator, 'appVersion', profile.appVersion);
    defineValue(navigator, 'appName', profile.appName);
    defineValue(navigator, 'appCodeName', profile.appCodeName);
    defineValue(navigator, 'product', profile.product);
    defineValue(navigator, 'productSub', profile.productSub);
    defineValue(navigator, 'vendorSub', profile.vendorSub);
    defineValue(navigator, 'cookieEnabled', true);
    defineValue(navigator, 'onLine', true);
    defineValue(navigator, 'webdriver', false);
    defineValue(navigator, 'doNotTrack', '1');
    defineValue(navigator, 'msDoNotTrack', '1');
  } catch (e) {
    // Silently fail
  }

  // Normalize userAgentData when possible
  try {
    if (navigator.userAgentData) {
      const uaBrands = [
        { brand: 'Not=A?Brand', version: '24' },
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Google Chrome', version: chromeMajor }
      ];
      const uaData = {
        brands: uaBrands,
        mobile: false,
        platform: uaPlatform,
        getHighEntropyValues: async (hints = []) => {
          const values = {
            architecture: 'x86',
            bitness: '64',
            model: '',
            platform: uaPlatform,
            platformVersion: platformVersion,
            uaFullVersion: chromeFull,
            fullVersionList: [
              { brand: 'Not=A?Brand', version: '24.0.0.0' },
              { brand: 'Chromium', version: chromeFull },
              { brand: 'Google Chrome', version: chromeFull }
            ]
          };

          if (!Array.isArray(hints) || hints.length === 0) {
            return values;
          }

          return hints.reduce((acc, hint) => {
            if (Object.prototype.hasOwnProperty.call(values, hint)) {
              acc[hint] = values[hint];
            }
            return acc;
          }, {});
        }
      };
      defineValue(navigator, 'userAgentData', uaData);
    }
  } catch (e) {
    // Silently fail
  }

  // Provide a minimal Chrome object for UA consistency
  try {
    if (!window.chrome) {
      defineValue(window, 'chrome', { runtime: {} });
    }
  } catch (e) {
    // Silently fail
  }

  // Normalize connection info
  try {
    const connection = {
      downlink: 10,
      effectiveType: '4g',
      rtt: 50,
      saveData: false
    };
    if (navigator.connection) defineValue(navigator, 'connection', connection);
    if (navigator.mozConnection) defineValue(navigator, 'mozConnection', connection);
    if (navigator.webkitConnection) defineValue(navigator, 'webkitConnection', connection);
  } catch (e) {
    // Silently fail
  }

  // Normalize storage estimates
  try {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate = async () => ({
        quota: 1073741824,
        usage: 0
      });
    }
  } catch (e) {
    // Silently fail
  }

  // Reduce surface of high-entropy APIs
  try {
    defineValue(navigator, 'bluetooth', undefined);
    defineValue(navigator, 'usb', undefined);
    defineValue(navigator, 'hid', undefined);
    defineValue(navigator, 'serial', undefined);
    defineValue(navigator, 'mediaCapabilities', undefined);
    defineValue(navigator, 'gpu', undefined);
  } catch (e) {
    // Silently fail
  }

  // Hide plugins and mimeTypes
  try {
    defineValue(navigator, 'plugins', Object.create(PluginArray.prototype, {
      length: { value: 0, writable: false, enumerable: true },
      item: { value: () => null, writable: false, enumerable: true },
      namedItem: { value: () => null, writable: false, enumerable: true },
      refresh: { value: () => {}, writable: false, enumerable: true }
    }));

    defineValue(navigator, 'mimeTypes', Object.create(MimeTypeArray.prototype, {
      length: { value: 0, writable: false, enumerable: true },
      item: { value: () => null, writable: false, enumerable: true },
      namedItem: { value: () => null, writable: false, enumerable: true }
    }));
  } catch (e) {
    // Silently fail
  }

  // Normalize font checks to a small allowlist
  try {
    if (document && document.fonts && typeof document.fonts.check === 'function') {
      const allowedFonts = ['arial', 'times new roman', 'courier new', 'verdana', 'georgia', 'tahoma'];
      document.fonts.check = function(font) {
        const fontSpec = String(font || '').toLowerCase();
        return allowedFonts.some(name => fontSpec.includes(name));
      };
    }
  } catch (e) {
    // Silently fail
  }

  // Normalize font metric probes on hidden elements
  try {
    function shouldNormalizeElementMetrics(element) {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return true;
      }
      if (style.position === 'absolute' || style.position === 'fixed') {
        const left = parseFloat(style.left || '0');
        const top = parseFloat(style.top || '0');
        if (left < -1000 || top < -1000) {
          return true;
        }
      }
      return false;
    }

    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const rect = originalGetBoundingClientRect.call(this);
      if (!shouldNormalizeElementMetrics(this)) return rect;

      const width = 100;
      const height = 20;
      if (typeof DOMRect === 'function') {
        return new DOMRect(0, 0, width, height);
      }
      return {
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height
      };
    };

    function patchElementMetric(name, fallbackValue) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
      if (!descriptor || typeof descriptor.get !== 'function') return;
      Object.defineProperty(HTMLElement.prototype, name, {
        get: function() {
          const value = descriptor.get.call(this);
          if (shouldNormalizeElementMetrics(this)) return fallbackValue;
          return value;
        },
        configurable: false,
        enumerable: descriptor.enumerable
      });
    }

    patchElementMetric('offsetWidth', 100);
    patchElementMetric('offsetHeight', 20);
    patchElementMetric('clientWidth', 100);
    patchElementMetric('clientHeight', 20);
  } catch (e) {
    // Silently fail
  }

  // Canvas fingerprint protection with deterministic output
  try {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    function blankCanvasFrom(source) {
      const canvas = document.createElement('canvas');
      canvas.width = source.width || 0;
      canvas.height = source.height || 0;
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width && canvas.height) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas;
    }

    function sanitizeImageData(imageData) {
      if (imageData && imageData.data) {
        imageData.data.fill(0);
      }
      return imageData;
    }

    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      try {
        const blank = blankCanvasFrom(this);
        return originalToDataURL.apply(blank, args);
      } catch (e) {
        return originalToDataURL.apply(this, args);
      }
    };

    HTMLCanvasElement.prototype.toBlob = function(...args) {
      try {
        const blank = blankCanvasFrom(this);
        return originalToBlob.apply(blank, args);
      } catch (e) {
        return originalToBlob.apply(this, args);
      }
    };

    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      try {
        const imageData = originalGetImageData.apply(this, args);
        return sanitizeImageData(imageData);
      } catch (e) {
        return originalGetImageData.apply(this, args);
      }
    };
  } catch (e) {
    // Silently fail
  }

  // Disable WebGL to reduce fingerprinting surface
  try {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (typeof type === 'string' && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
        return null;
      }
      return originalGetContext.call(this, type, ...args);
    };

    if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.getContext) {
      const originalOffscreenGetContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function(type, ...args) {
        if (typeof type === 'string' && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
          return null;
        }
        return originalOffscreenGetContext.call(this, type, ...args);
      };
    }
  } catch (e) {
    // Silently fail
  }

  // Limit WebGL debug renderer info
  try {
    const blockDebugInfo = (proto) => {
      if (!proto || !proto.getExtension) return;
      const originalGetExtension = proto.getExtension;
      Object.defineProperty(proto, 'getExtension', {
        value: function(name) {
          if (String(name).toLowerCase() === 'webgl_debug_renderer_info') {
            return null;
          }
          return originalGetExtension.call(this, name);
        },
        configurable: true,
        enumerable: true
      });

      if (typeof proto.getParameter === 'function') {
        const originalGetParameter = proto.getParameter;
        Object.defineProperty(proto, 'getParameter', {
          value: function(param) {
            if (param === 0x9245 || param === 0x9246) {
              return null;
            }
            return originalGetParameter.call(this, param);
          },
          configurable: true,
          enumerable: true
        });
      }
    };

    blockDebugInfo(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    blockDebugInfo(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  } catch (e) {
    // Silently fail
  }

  // Audio fingerprint protection
  try {
    function sanitizeAudioBuffer(buffer) {
      if (!buffer || !buffer.numberOfChannels) return buffer;
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channel = buffer.getChannelData(i);
        if (channel) channel.fill(0);
      }
      return buffer;
    }

    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineContext && OfflineContext.prototype && OfflineContext.prototype.startRendering) {
      const originalStartRendering = OfflineContext.prototype.startRendering;
      OfflineContext.prototype.startRendering = function() {
        const result = originalStartRendering.call(this);
        if (result && typeof result.then === 'function') {
          return result.then(sanitizeAudioBuffer);
        }
        return Promise.resolve(result).then(sanitizeAudioBuffer);
      };
    }

    if (typeof AudioContext !== 'undefined') {
      const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function() {
        const analyser = originalCreateAnalyser.call(this);
        analyser.getFloatFrequencyData = function(array) {
          if (array && array.length) array.fill(0);
        };
        analyser.getByteFrequencyData = function(array) {
          if (array && array.length) array.fill(0);
        };
        analyser.getFloatTimeDomainData = function(array) {
          if (array && array.length) array.fill(0);
        };
        analyser.getByteTimeDomainData = function(array) {
          if (array && array.length) array.fill(0);
        };
        return analyser;
      };
    }
  } catch (e) {
    // Silently fail
  }

  // Screen properties
  try {
    const viewportStep = 10;
    const baseWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : screenProfile.width;
    const baseHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : screenProfile.height;
    screenProfile = {
      width: quantize(baseWidth, viewportStep),
      height: quantize(baseHeight, viewportStep)
    };

    defineValue(screen, 'colorDepth', profile.colorDepth);
    defineValue(screen, 'pixelDepth', profile.pixelDepth);
    defineValue(screen, 'width', screenProfile.width);
    defineValue(screen, 'height', screenProfile.height);
    defineValue(screen, 'availWidth', screenProfile.width);
    defineValue(screen, 'availHeight', screenProfile.height);
    defineValue(screen, 'availLeft', 0);
    defineValue(screen, 'availTop', 0);
    defineValue(screen, 'left', 0);
    defineValue(screen, 'top', 0);

    defineValue(window, 'devicePixelRatio', 1);

    defineGetter(window, 'innerWidth', () => screenProfile.width);
    defineGetter(window, 'innerHeight', () => screenProfile.height);
    defineGetter(window, 'outerWidth', () => screenProfile.width);
    defineGetter(window, 'outerHeight', () => screenProfile.height);
    defineValue(window, 'screenX', 0);
    defineValue(window, 'screenY', 0);
    defineValue(window, 'screenLeft', 0);
    defineValue(window, 'screenTop', 0);
  } catch (e) {
    // Silently fail
  }

  // Normalize prefers-color-scheme to light
  try {
    if (typeof window.matchMedia === 'function') {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = function(query) {
        const mql = originalMatchMedia(query);
        if (typeof query === 'string' && query.includes('prefers-color-scheme')) {
          const matchesLight = query.includes('light');
          try {
            Object.defineProperty(mql, 'matches', {
              get: () => matchesLight,
              configurable: false
            });
          } catch (e) {
            // Ignore if not configurable
          }
        }
        return mql;
      };
    }
  } catch (e) {
    // Silently fail
  }

  // Block battery API
  try {
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.reject(new Error('Battery API blocked'));
    }
  } catch (e) {
    // Silently fail
  }

  // Block media devices enumeration
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('Media access blocked'));
    }

    if (navigator.getUserMedia) {
      navigator.getUserMedia = () => Promise.reject(new Error('Media access blocked'));
    }

    if (navigator.webkitGetUserMedia) {
      navigator.webkitGetUserMedia = () => Promise.reject(new Error('Media access blocked'));
    }

    if (navigator.mozGetUserMedia) {
      navigator.mozGetUserMedia = () => Promise.reject(new Error('Media access blocked'));
    }
  } catch (e) {
    // Silently fail
  }

  // Block Presentation API
  try {
    if (navigator.presentation) {
      navigator.presentation = undefined;
    }
  } catch (e) {
    // Silently fail
  }

  // Block gamepads
  try {
    if (navigator.getGamepads) {
      navigator.getGamepads = () => [];
    }

    if (navigator.webkitGetGamepads) {
      navigator.webkitGetGamepads = () => [];
    }
  } catch (e) {
    // Silently fail
  }

  // Normalize Permissions API
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const fakeStatus = { state: 'prompt', onchange: null };
      const overrideQuery = () => Promise.resolve(fakeStatus);
      navigator.permissions.query = overrideQuery;

      const permissionsProto = Object.getPrototypeOf(navigator.permissions);
      if (permissionsProto && permissionsProto.query) {
        Object.defineProperty(permissionsProto, 'query', {
          value: overrideQuery,
          configurable: true,
          enumerable: true
        });
      }
    }
  } catch (e) {
    // Silently fail
  }

  // Normalize timezone
  try {
    const tzOffset = 0;
    Date.prototype.getTimezoneOffset = function() {
      return tzOffset;
    };

    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat !== 'undefined') {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        const options = originalResolvedOptions.call(this);
        options.locale = profile.language;
        options.timeZone = 'UTC';
        return options;
      };
    }
  } catch (e) {
    // Silently fail
  }

  // Reduce timing precision
  try {
    if (typeof performance !== 'undefined' && performance.now) {
      const originalNow = performance.now.bind(performance);
      let lastNow = 0;
      performance.now = function() {
        const quantized = Math.floor(originalNow() / 50) * 50;
        if (quantized <= lastNow) {
          lastNow += 1;
          return lastNow;
        }
        lastNow = quantized;
        return quantized;
      };
    }
  } catch (e) {
    // Silently fail
  }

  try {
    if (typeof performance !== 'undefined') {
      const origin = performance.timeOrigin || (Date.now() - (performance.now ? performance.now() : 0));
      defineValue(performance, 'timeOrigin', Math.floor(origin / 1000) * 1000);
    }
  } catch (e) {
    // Silently fail
  }

  try {
    if (typeof performance !== 'undefined' && performance.timing) {
      const timing = performance.timing;
      const sanitized = {};
      Object.keys(timing).forEach((key) => {
        const value = timing[key];
        sanitized[key] = typeof value === 'number' ? Math.round(value / 100) * 100 : value;
      });
      Object.defineProperty(performance, 'timing', {
        get: () => sanitized,
        configurable: false,
        enumerable: true
      });
    }
  } catch (e) {
    // Silently fail
  }

  console.log('[Vitamin] Fingerprint protection active');
})();
