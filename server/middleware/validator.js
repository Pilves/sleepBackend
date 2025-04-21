/**
 * Request Validation Middleware
 * Provides validation for API requests using express-validator
 */
const { validationResult, checkSchema } = require('express-validator');

// Validation schemas for different API endpoints
const validationSchemas = {
  // Authentication routes
  register: {
    email: {
      in: ['body'],
      isEmail: {
        errorMessage: 'Please provide a valid email address'
      },
      normalizeEmail: true,
      trim: true
    },
    username: {
      in: ['body'],
      isString: true,
      isLength: {
        options: { min: 3, max: 30 },
        errorMessage: 'Username must be between 3 and 30 characters'
      },
      matches: {
        options: /^[a-zA-Z0-9_-]+$/,
        errorMessage: 'Username can only contain letters, numbers, underscores, and hyphens'
      },
      trim: true
    },
    displayName: {
      in: ['body'],
      isString: true,
      isLength: {
        options: { min: 1, max: 50 },
        errorMessage: 'Display name must be between 1 and 50 characters'
      },
      trim: true
    },
    invitationCode: {
      in: ['body'],
      isString: true,
      optional: false,
      isLength: {
        options: { min: 3 }, // Reduced to allow DEV123
        errorMessage: 'Invalid invitation code'
      },
      trim: true
    }
  },
  
  resetPassword: {
    email: {
      in: ['body'],
      isEmail: {
        errorMessage: 'Please provide a valid email address'
      },
      normalizeEmail: true,
      trim: true
    }
  },
  
  // User profile routes
  updateProfile: {
    displayName: {
      in: ['body'],
      optional: true,
      isString: true,
      isLength: {
        options: { min: 1, max: 50 },
        errorMessage: 'Display name must be between 1 and 50 characters'
      },
      trim: true
    },
    'profileData.gender': {
      in: ['body'],
      optional: true,
      isString: true,
      isIn: {
        options: [['male', 'female', 'other', 'prefer not to say']],
        errorMessage: 'Gender must be one of: male, female, other, prefer not to say'
      }
    },
    'profileData.age': {
      in: ['body'],
      optional: true,
      isInt: {
        options: { min: 13, max: 120 },
        errorMessage: 'Age must be between 13 and 120'
      },
      toInt: true
    },
    'profileData.aboutMe': {
      in: ['body'],
      optional: true,
      isString: true,
      isLength: {
        options: { max: 500 },
        errorMessage: 'About me must not exceed 500 characters'
      }
    },
    'profileData.profilePicture': {
      in: ['body'],
      optional: true,
      isURL: {
        errorMessage: 'Profile picture must be a valid URL'
      }
    }
  },
  
  updateNotificationPreferences: {
    email: {
      in: ['body'],
      optional: true,
      isBoolean: true,
      toBoolean: true
    },
    inApp: {
      in: ['body'],
      optional: true,
      isBoolean: true,
      toBoolean: true
    }
  },
  
  // Oura integration routes
  connectOura: {
    apiKey: {
      in: ['body'],
      isString: true,
      isLength: {
        options: { min: 10 },
        errorMessage: 'Invalid API key'
      },
      trim: true
    }
  },
  
  // Sleep data routes
  dateParam: {
    date: {
      in: ['params'],
      isString: true,
      matches: {
        options: /^\d{4}-\d{2}-\d{2}$/,
        errorMessage: 'Date must be in format YYYY-MM-DD'
      }
    }
  },
  
  dateRange: {
    days: {
      in: ['query'],
      optional: true,
      isInt: {
        options: { min: 1, max: 90 },
        errorMessage: 'Days parameter must be a positive number (max 90)'
      },
      toInt: true
    },
    startDate: {
      in: ['query'],
      optional: true,
      isString: true,
      matches: {
        options: /^\d{4}-\d{2}-\d{2}$/,
        errorMessage: 'Start date must be in format YYYY-MM-DD'
      },
      custom: {
        options: (value, { req }) => {
          // If days parameter is provided, we don't need start/end dates
          if (req.query.days) return true;
          
          // If startDate is provided, endDate must also be provided
          if (!req.query.endDate) {
            throw new Error('Both startDate and endDate must be provided together');
          }
          return true;
        }
      }
    },
    endDate: {
      in: ['query'],
      optional: true,
      isString: true,
      matches: {
        options: /^\d{4}-\d{2}-\d{2}$/,
        errorMessage: 'End date must be in format YYYY-MM-DD'
      },
      custom: {
        options: (value, { req }) => {
          // If days parameter is provided, we don't need start/end dates
          if (req.query.days) return true;
          
          // If endDate is provided, startDate must also be provided
          if (!req.query.startDate) {
            throw new Error('Both startDate and endDate must be provided together');
          }
          
          const start = new Date(req.query.startDate);
          const end = new Date(value);
          
          if (end < start) {
            throw new Error('End date must be after start date');
          }
          
          const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) {
            throw new Error('Date range cannot exceed 30 days');
          }
          
          return true;
        }
      }
    }
  },
  
  addSleepNote: {
    note: {
      in: ['body'],
      optional: true,
      isString: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'Note cannot exceed 1000 characters'
      }
    },
    tags: {
      in: ['body'],
      optional: true,
      isArray: true,
      custom: {
        options: (value) => {
          if (!Array.isArray(value)) {
            throw new Error('Tags must be an array');
          }
          
          if (value.some(tag => typeof tag !== 'string')) {
            throw new Error('All tags must be strings');
          }
          
          if (value.some(tag => tag.length > 50)) {
            throw new Error('Tags cannot exceed 50 characters');
          }
          
          return true;
        }
      }
    }
  },
  
  // Competition routes
  competitionId: {
    competitionId: {
      in: ['params'],
      isString: true,
      trim: true
    }
  },
  
  createCompetition: {
    title: {
      in: ['body'],
      isString: true,
      isLength: {
        options: { min: 3, max: 100 },
        errorMessage: 'Title must be between 3 and 100 characters'
      },
      trim: true
    },
    description: {
      in: ['body'],
      isString: true,
      isLength: {
        options: { min: 3, max: 2000 },
        errorMessage: 'Description must be between 3 and 2000 characters'
      }
    },
    type: {
      in: ['body'],
      isString: true,
      isIn: {
        options: [['DAILY', 'WEEKLY', 'CHALLENGE', 'CUSTOM', 
                  'highest_score', 'improvement', 'consistency', 'deep_sleep', 'efficiency']],
        errorMessage: 'Type must be one of: DAILY, WEEKLY, CHALLENGE, CUSTOM, highest_score, improvement, consistency, deep_sleep, efficiency'
      }
    },
    startDate: {
      in: ['body'],
      custom: {
        options: (value) => {
          try {
            // Accept both date strings and ISO strings
            new Date(value);
            return true;
          } catch (error) {
            throw new Error('Start date must be a valid date');
          }
        }
      }
    },
    endDate: {
      in: ['body'],
      custom: {
        options: (value, { req }) => {
          try {
            if (!req.body.startDate) return true;
            
            const start = new Date(req.body.startDate);
            const end = new Date(value);
            
            if (end <= start) {
              throw new Error('End date must be after start date');
            }
            
            return true;
          } catch (error) {
            throw new Error('End date must be a valid date');
          }
        }
      }
    },
    status: {
      in: ['body'],
      optional: true,
      isString: true,
      isIn: {
        options: [['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 
                  'upcoming', 'active', 'completed']],
        errorMessage: 'Status must be one of: PENDING, ACTIVE, COMPLETED, CANCELLED, upcoming, active, completed'
      }
    }
  },
  
  // Update competition schema for PUT requests
  updateCompetition: {
    title: {
      in: ['body'],
      optional: true,
      isString: true,
      isLength: {
        options: { min: 3, max: 100 },
        errorMessage: 'Title must be between 3 and 100 characters'
      },
      trim: true
    },
    description: {
      in: ['body'],
      optional: true,
      isString: true,
      isLength: {
        options: { min: 3, max: 2000 },
        errorMessage: 'Description must be between 3 and 2000 characters'
      }
    },
    type: {
      in: ['body'],
      optional: true,
      isString: true,
      isIn: {
        options: [['DAILY', 'WEEKLY', 'CHALLENGE', 'CUSTOM', 
                  'highest_score', 'improvement', 'consistency', 'deep_sleep', 'efficiency']],
        errorMessage: 'Type must be one of: DAILY, WEEKLY, CHALLENGE, CUSTOM, highest_score, improvement, consistency, deep_sleep, efficiency'
      }
    },
    startDate: {
      in: ['body'],
      optional: true,
      custom: {
        options: (value) => {
          try {
            // Accept both date strings and ISO strings
            new Date(value);
            return true;
          } catch (error) {
            throw new Error('Start date must be a valid date');
          }
        }
      }
    },
    endDate: {
      in: ['body'],
      optional: true,
      custom: {
        options: (value, { req }) => {
          try {
            // If startDate is provided in the request, use it; otherwise no validation needed
            if (req.body.startDate) {
              const start = new Date(req.body.startDate);
              const end = new Date(value);
              
              if (end <= start) {
                throw new Error('End date must be after start date');
              }
            }
            return true;
          } catch (error) {
            throw new Error('End date must be a valid date');
          }
        }
      }
    },
    status: {
      in: ['body'],
      optional: true,
      isString: true,
      isIn: {
        options: [['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 
                  'upcoming', 'active', 'completed']],
        errorMessage: 'Status must be one of: PENDING, ACTIVE, COMPLETED, CANCELLED, upcoming, active, completed'
      }
    },
    rules: {
      in: ['body'],
      optional: true
    },
    prizes: {
      in: ['body'],
      optional: true,
      isArray: true,
      custom: {
        options: (value) => {
          if (!Array.isArray(value)) {
            throw new Error('Prizes must be an array');
          }
          return true;
        }
      }
    }
  },
  
  // Update competition status schema for PATCH requests
  updateCompetitionStatus: {
    status: {
      in: ['body'],
      isString: true,
      isIn: {
        options: [['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 
                  'upcoming', 'active', 'completed']],
        errorMessage: 'Status must be one of: PENDING, ACTIVE, COMPLETED, CANCELLED, upcoming, active, completed'
      }
    }
  },
  
  // Notification routes
  notificationPagination: {
    limit: {
      in: ['query'],
      optional: true,
      isInt: {
        options: { min: 1, max: 100 },
        errorMessage: 'Limit must be between 1 and 100'
      },
      toInt: true
    },
    offset: {
      in: ['query'],
      optional: true,
      isInt: {
        options: { min: 0 },
        errorMessage: 'Offset must be a non-negative integer'
      },
      toInt: true
    },
    unreadOnly: {
      in: ['query'],
      optional: true,
      customSanitizer: {
        options: (value) => {
          return value === 'true';
        }
      },
      isBoolean: true
    }
  },
  
  // Invitation routes
  createInvitation: {
    email: {
      in: ['body'],
      isEmail: {
        errorMessage: 'Please provide a valid email address'
      },
      normalizeEmail: true,
      trim: true
    }
  }
};

/**
 * Middleware to validate request based on schema
 * @param {string} schemaName - Name of the validation schema to use
 * @returns {function} Express middleware function
 */
const validate = (schemaName) => {
  if (!validationSchemas[schemaName]) {
    throw new Error(`Validation schema '${schemaName}' not found`);
  }
  
  return [
    checkSchema(validationSchemas[schemaName]),
    (req, res, next) => {
      const errors = validationResult(req);
      
      if (!errors.isEmpty()) {
        console.log(`Validation failed for ${schemaName}:`, {
          body: JSON.stringify(req.body).substring(0, 200),
          schema: schemaName
        });
        console.log('Validation errors:', errors.array());
        
        // Extract most important error message
        const errorMessages = errors.array().map(err => err.msg);
        const mainError = errorMessages[0] || 'Validation failed';
        
        return res.status(400).json({
          error: mainError,
          message: `Validation failed for ${schemaName}: ${errorMessages.join(', ')}`,
          details: errors.array(),
          receivedData: req.body
        });
      }
      
      next();
    }
  ];
};

module.exports = { validate };