// Fingerprint protection script - injected into page context
// This script randomizes common fingerprinting vectors with more robust approach

(function() {
  'use strict';

  // Generate a session-stable random seed based on origin
  const sessionSeed = Math.random() * 10000 | 0;

  // Simple seeded random for consistent spoofing per session
  function seededRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  // Generate spoofed values that match common browser configurations
  const spoofedHardwareConcurrency = [2, 4, 8][sessionSeed % 3]; // Common values
  const spoofedDeviceMemory = [2, 4, 8][sessionSeed % 3]; // Common values
  const spoofedColorDepth = 24;
  const spoofedPixelDepth = 24;

  // Spoof navigator properties with more robust approach
  try {
    // Hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => spoofedHardwareConcurrency,
      configurable: false,
      enumerable: true
    });
    
    // Device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => spoofedDeviceMemory,
      configurable: false,
      enumerable: true
    });
    
    // Max touch points
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
      configurable: false,
      enumerable: true
    });
    
    // Platform - spoof to common value
    Object.defineProperty(navigator, 'platform', {
      get: () => ['Win32', 'Linux x86_64', 'MacIntel'][sessionSeed % 3],
      configurable: false,
      enumerable: true
    });
    
    // Vendor - spoof to common value
    Object.defineProperty(navigator, 'vendor', {
      get: () => ['Google Inc.', 'Apple Computer, Inc.', ''][sessionSeed % 3],
      configurable: false,
      enumerable: true
    });
    
    // Language - spoof to common value
    Object.defineProperty(navigator, 'language', {
      get: () => ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES'][sessionSeed % 5],
      configurable: false,
      enumerable: true
    });
    
    // Languages - spoof to common values
    Object.defineProperty(navigator, 'languages', {
      get: () => {
        const langs = ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES'];
        const count = 1 + (sessionSeed % 3);
        const result = [];
        for (let i = 0; i < count; i++) {
          result.push(langs[(sessionSeed + i) % langs.length]);
        }
        return result;
      },
      configurable: false,
      enumerable: true
    });
    
    // Cookie enabled
    Object.defineProperty(navigator, 'cookieEnabled', {
      get: () => true,
      configurable: false,
      enumerable: true
    });
    
    // OnLine
    Object.defineProperty(navigator, 'onLine', {
      get: () => true,
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Hide plugins array completely
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        // Return a fake PluginArray that looks real but is empty
        return Object.create(PluginArray.prototype, {
          length: { value: 0, writable: false, enumerable: true },
          item: { value: () => null, writable: false, enumerable: true },
          namedItem: { value: () => null, writable: false, enumerable: true },
          refresh: { value: () => {}, writable: false, enumerable: true }
        });
      },
      configurable: false,
      enumerable: true
    });
    
    // Hide mimeTypes completely
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        // Return a fake MimeTypeArray that looks real but is empty
        return Object.create(MimeTypeArray.prototype, {
          length: { value: 0, writable: false, enumerable: true },
          item: { value: () => null, writable: false, enumerable: true },
          namedItem: { value: () => null, writable: false, enumerable: true }
        });
      },
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Completely override canvas fingerprinting with robust approach
  try {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // Create completely randomized canvas noise
    function addCanvasNoise(canvas) {
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Fill canvas with completely random noise
        const width = canvas.width;
        const height = canvas.height;
        
        // Create ImageData with random pixels
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        
        // Fill with completely random noise
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.floor(Math.random() * 256);
        }
        
        ctx.putImageData(imageData, 0, 0);
      } catch (e) {
        // Silently fail - don't break the page
      }
    }

    // Override canvas methods to add noise
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      try {
        addCanvasNoise(this);
      } catch (e) {
        // Silently fail - don't break the page
      }
      return originalToDataURL.apply(this, args);
    };

    HTMLCanvasElement.prototype.toBlob = function(...args) {
      try {
        addCanvasNoise(this);
      } catch (e) {
        // Silently fail - don't break the page
      }
      return originalToBlob.apply(this, args);
    };

    // Override getImageData to return random data
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      try {
        const imageData = originalGetImageData.apply(this, args);
        const data = imageData.data;
        
        // Fill with completely random noise
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.floor(Math.random() * 256);
        }
        
        return imageData;
      } catch (e) {
        return originalGetImageData.apply(this, args);
      }
    };

    // Override other canvas methods that can be used for fingerprinting
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      try {
        const result = originalMeasureText.apply(this, arguments);
        // Add slight randomization to text measurements to prevent font fingerprinting
        if (result && result.width) {
          result.width += (Math.random() - 0.5) * 2;
        }
        return result;
      } catch (e) {
        return originalMeasureText.apply(this, arguments);
      }
    };
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Completely randomize WebGL fingerprinting
  try {
    const getParameterOriginal = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      try {
        // For common fingerprinting parameters, return random values
        switch (param) {
          case 37445: // UNMASKED_VENDOR_WEBGL
            return ['', 'Google Inc.', 'Apple', 'NVIDIA Corporation', 'Intel Inc.', 'AMD'][Math.floor(Math.random() * 6)];
          case 37446: // UNMASKED_RENDERER_WEBGL
            return ['', 'WebKit WebGL', 'Google Chrome', 'Firefox', 'Safari', 'Intel', 'AMD', 'NVIDIA'][Math.floor(Math.random() * 8)];
          case 34076: // MAX_RENDERBUFFER_SIZE
            return 1024 + Math.floor(Math.random() * 15360);
          case 3379: // MAX_TEXTURE_SIZE
            return 2048 + Math.floor(Math.random() * 14336);
          case 34024: // MAX_CUBE_MAP_TEXTURE_SIZE
            return 512 + Math.floor(Math.random() * 8192);
          case 35661: // MAX_VERTEX_ATTRIBS
            return 8 + Math.floor(Math.random() * 8);
          case 35660: // MAX_VERTEX_UNIFORM_VECTORS
            return 128 + Math.floor(Math.random() * 512);
          case 35657: // MAX_VARYING_VECTORS
            return 8 + Math.floor(Math.random() * 8);
          case 35663: // MAX_VERTEX_TEXTURE_IMAGE_UNITS
            return 0 + Math.floor(Math.random() * 16);
          case 35662: // MAX_TEXTURE_IMAGE_UNITS
            return 8 + Math.floor(Math.random() * 8);
          case 36347: // MAX_FRAGMENT_UNIFORM_VECTORS
            return 16 + Math.floor(Math.random() * 112);
          case 36348: // MAX_COMBINED_TEXTURE_IMAGE_UNITS
            return 8 + Math.floor(Math.random() * 24);
          case 33901: // ALIASED_LINE_WIDTH_RANGE
            return [1, 1];
          case 33902: // ALIASED_POINT_SIZE_RANGE
            return [1, 1024];
          default:
            // For other parameters, return random values or original
            if (Math.random() > 0.7) {
              return Math.floor(Math.random() * 100000);
            }
            return getParameterOriginal.apply(this, arguments);
        }
      } catch (e) {
        return getParameterOriginal.apply(this, arguments);
      }
    };

    // Block WebGL debug renderer info extension
    const originalGetExtension = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function(name) {
      try {
        if (name === 'WEBGL_debug_renderer_info') {
          return null; // Block this extension completely
        }
        return originalGetExtension.apply(this, arguments);
      } catch (e) {
        return originalGetExtension.apply(this, arguments);
      }
    };
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Also protect WebGL2 if available
  try {
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Original = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        try {
          // For common fingerprinting parameters, return random values
          switch (param) {
            case 37445: // UNMASKED_VENDOR_WEBGL
              return ['', 'Google Inc.', 'Apple', 'NVIDIA Corporation', 'Intel Inc.', 'AMD'][Math.floor(Math.random() * 6)];
            case 37446: // UNMASKED_RENDERER_WEBGL
              return ['', 'WebKit WebGL', 'Google Chrome', 'Firefox', 'Safari', 'Intel', 'AMD', 'NVIDIA'][Math.floor(Math.random() * 8)];
            case 34076: // MAX_RENDERBUFFER_SIZE
              return 1024 + Math.floor(Math.random() * 15360);
            case 3379: // MAX_TEXTURE_SIZE
              return 2048 + Math.floor(Math.random() * 14336);
            default:
              // For other parameters, return random values or original
              if (Math.random() > 0.7) {
                return Math.floor(Math.random() * 100000);
              }
              return getParameter2Original.apply(this, arguments);
          }
        } catch (e) {
          return getParameter2Original.apply(this, arguments);
        }
      };

      // Block WebGL debug renderer info extension for WebGL2
      const originalGetExtension2 = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function(name) {
        try {
          if (name === 'WEBGL_debug_renderer_info') {
            return null; // Block this extension completely
          }
          return originalGetExtension2.apply(this, arguments);
        } catch (e) {
          return originalGetExtension2.apply(this, arguments);
        }
      };
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Completely randomize AudioContext fingerprinting
  try {
    if (typeof AudioContext !== 'undefined') {
      const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function() {
        try {
          const analyser = originalCreateAnalyser.call(this);
          const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
          const originalGetByteFrequencyData = analyser.getByteFrequencyData;
          const originalGetFloatTimeDomainData = analyser.getFloatTimeDomainData;
          const originalGetByteTimeDomainData = analyser.getByteTimeDomainData;
          
          // Override all audio analysis methods to return random data
          analyser.getFloatFrequencyData = function(array) {
            try {
              for (let i = 0; i < array.length; i++) {
                array[i] = (Math.random() * 2) - 1; // Random values between -1 and 1
              }
            } catch (e) {
              // Silently fail
            }
          };
          
          analyser.getByteFrequencyData = function(array) {
            try {
              for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256); // Random values between 0 and 255
              }
            } catch (e) {
              // Silently fail
            }
          };
          
          analyser.getFloatTimeDomainData = function(array) {
            try {
              for (let i = 0; i < array.length; i++) {
                array[i] = (Math.random() * 2) - 1; // Random values between -1 and 1
              }
            } catch (e) {
              // Silently fail
            }
          };
          
          analyser.getByteTimeDomainData = function(array) {
            try {
              for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256); // Random values between 0 and 255
              }
            } catch (e) {
              // Silently fail
            }
          };
          
          return analyser;
        } catch (e) {
          return originalCreateAnalyser.call(this);
        }
      };
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Spoof screen properties with common values
  try {
    Object.defineProperty(screen, 'colorDepth', {
      get: () => spoofedColorDepth,
      configurable: false,
      enumerable: true
    });
    Object.defineProperty(screen, 'pixelDepth', {
      get: () => spoofedPixelDepth,
      configurable: false,
      enumerable: true
    });
    
    // Common screen dimensions
    const screenWidths = [1920, 1366, 1440, 1536, 1280, 1600, 1680, 1024];
    const screenHeights = [1080, 768, 900, 864, 720, 900, 1050, 768];
    
    Object.defineProperty(screen, 'width', {
      get: () => screenWidths[sessionSeed % screenWidths.length],
      configurable: false,
      enumerable: true
    });
    Object.defineProperty(screen, 'height', {
      get: () => screenHeights[sessionSeed % screenHeights.length],
      configurable: false,
      enumerable: true
    });
    Object.defineProperty(screen, 'availWidth', {
      get: () => screenWidths[sessionSeed % screenWidths.length],
      configurable: false,
      enumerable: true
    });
    Object.defineProperty(screen, 'availHeight', {
      get: () => screenHeights[sessionSeed % screenHeights.length],
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Block battery API completely
  try {
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.reject(new Error('Battery API blocked'));
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Block media devices API to prevent camera/microphone enumeration
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    }
    
    // Block getUserMedia to prevent camera/microphone access enumeration
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
    // Silently fail - don't break the page
  }

  // Block Presentation API which can be used for fingerprinting
  try {
    if (navigator.presentation) {
      navigator.presentation = undefined;
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Block other fingerprinting APIs
  try {
    if (navigator.getGamepads) {
      navigator.getGamepads = () => [];
    }

    if (navigator.webkitGetGamepads) {
      navigator.webkitGetGamepads = () => [];
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Block Permissions API queries which can be used for fingerprinting
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const originalPermissionsQuery = navigator.permissions.query;
      navigator.permissions.query = (permissionDesc) => {
        try {
          // For sensitive permissions, return "prompt" to prevent fingerprinting
          if (permissionDesc && permissionDesc.name && ['geolocation', 'notifications', 'camera', 'microphone', 'midi'].includes(permissionDesc.name)) {
            return Promise.resolve({
              state: 'prompt',
              onchange: null
            });
          }
          return originalPermissionsQuery.call(navigator.permissions, permissionDesc);
        } catch (e) {
          return originalPermissionsQuery.call(navigator.permissions, permissionDesc);
        }
      };
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Spoof timezone to common values
  try {
    const commonTimezones = [
      -480, // UTC-8 (PST)
      -420, // UTC-7 (PDT)
      -300, // UTC-5 (EST)
      -240, // UTC-4 (EDT)
      0,    // UTC
      60,   // UTC+1 (CET)
      120,  // UTC+2 (CEST)
      330,  // UTC+5:30 (IST)
      480,  // UTC+8 (CST)
      540   // UTC+9 (JST)
    ];
    const spoofedTimezone = commonTimezones[sessionSeed % commonTimezones.length];
    
    Date.prototype.getTimezoneOffset = function() { 
      return spoofedTimezone; 
    };
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Override Intl API to prevent locale-based fingerprinting
  try {
    if (typeof Intl !== 'undefined') {
      // Spoof DateTimeFormat resolved options
      if (typeof Intl.DateTimeFormat !== 'undefined') {
        const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {
          try {
            const options = originalResolvedOptions.call(this);
            options.locale = ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES'][sessionSeed % 5];
            options.timeZone = ['America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai'][sessionSeed % 5];
            return options;
          } catch (e) {
            return originalResolvedOptions.call(this);
          }
        };
      }
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Override performance.now to prevent timing attacks
  try {
    if (typeof performance !== 'undefined' && performance.now) {
      const originalNow = performance.now;
      performance.now = function() {
        try {
          // Return completely random values to prevent timing-based fingerprinting
          return Math.random() * 1000000;
        } catch (e) {
          return originalNow.call(this);
        }
      };
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  // Override performance.timing to prevent timing-based fingerprinting
  try {
    if (typeof performance !== 'undefined' && performance.timing) {
      // Create a completely fake timing object
      const fakeTiming = {
        navigationStart: Date.now() - Math.floor(Math.random() * 10000),
        unloadEventStart: 0,
        unloadEventEnd: 0,
        redirectStart: 0,
        redirectEnd: 0,
        fetchStart: Date.now() - Math.floor(Math.random() * 5000),
        domainLookupStart: Date.now() - Math.floor(Math.random() * 4000),
        domainLookupEnd: Date.now() - Math.floor(Math.random() * 3000),
        connectStart: Date.now() - Math.floor(Math.random() * 3000),
        connectEnd: Date.now() - Math.floor(Math.random() * 2000),
        secureConnectionStart: Date.now() - Math.floor(Math.random() * 2500),
        requestStart: Date.now() - Math.floor(Math.random() * 2000),
        responseStart: Date.now() - Math.floor(Math.random() * 1000),
        responseEnd: Date.now() - Math.floor(Math.random() * 500),
        domLoading: Date.now() - Math.floor(Math.random() * 800),
        domInteractive: Date.now() - Math.floor(Math.random() * 600),
        domContentLoadedEventStart: Date.now() - Math.floor(Math.random() * 500),
        domContentLoadedEventEnd: Date.now() - Math.floor(Math.random() * 400),
        domComplete: Date.now() - Math.floor(Math.random() * 200),
        loadEventStart: Date.now() - Math.floor(Math.random() * 100),
        loadEventEnd: Date.now()
      };
      
      Object.defineProperty(performance, 'timing', {
        get: () => fakeTiming,
        configurable: false,
        enumerable: true
      });
    }
  } catch (e) {
    // Silently fail - don't break the page
  }

  console.log('[Vitamin] Robust fingerprint protection active');
})();