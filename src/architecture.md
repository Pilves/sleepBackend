

/sleep-olympics/
├── .dockerignore
├── .env.example
├── .eslintrc.js
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── jest.config.js
├── package.json
├── tsconfig.json
├── README.md
│
├── scripts/                                  # Utility scripts
│   ├── deploy.sh
│   ├── backup-data.sh 
│   └── migrate-data.sh
│
├── config/                                   # Application configuration
│   └── index.ts                              # Environment variables & config
│
├── shared/                                   # Shared utilities/types
│   ├── middleware/                           # Common middleware
│   │   ├── auth.ts                           # Authentication middleware
│   │   ├── error.ts                          # Error handling middleware
│   │   ├── validator.ts                      # Request validation
│   │   ├── rateLimit.ts                      # Rate limiting
│   │   └── logging.ts                        # Request logging
│   │
│   ├── utils/                                # Shared utilities
│   │   ├── errors.ts                         # Custom error classes
│   │   ├── logger.ts                         # Logging utility
│   │   ├── crypto.ts                         # Encryption utilities
│   │   ├── date.ts                           # Date handling utilities
│   │   └── responseFormatter.ts              # API response formatter
│   │
│   └── types/                                # Common types
│       ├── common.ts                         # Shared type definitions
│       └── express.d.ts                      # Express extensions
│
├── infrastructure/                           # Core infrastructure
│   ├── database/                             # Database connection
│   │   └── firebase.ts                       # Firebase/Firestore initialization
│   │
│   ├── cache/                                # Caching infrastructure
│   │   ├── cacheManager.ts                   # Cache interface
│   │   ├── redisCache.ts                     # Redis implementation
│   │   └── memoryCache.ts                    # In-memory fallback
│   │
│   └── queue/                                # Background processing
│       ├── jobQueue.ts                       # Queue interface
│       └── bullQueue.ts                      # Bull implementation
│
├── features/                                 # Business features
│   ├── auth/                                 # Authentication feature
│   │   ├── controllers/
│   │   │   └── authController.ts             # Auth endpoints
│   │   ├── services/
│   │   │   └── authService.ts                # Auth business logic
│   │   ├── repositories/
│   │   │   ├── interfaces/
│   │   │   │   └── userAuthRepository.ts     # Auth repo interface
│   │   │   └── userAuthRepository.ts         # Auth repo implementation
│   │   ├── models/
│   │   │   └── RefreshToken.ts               # Token model
│   │   ├── types/
│   │   │   └── auth.ts                       # Auth-specific types
│   │   ├── validators/
│   │   │   ├── loginValidator.ts             # Login validation
│   │   │   └── registerValidator.ts          # Registration validation
│   │   └── routes.ts                         # Auth routes
│   │
│   ├── user/                                 # User management feature
│   │   ├── controllers/
│   │   │   └── userController.ts             # User endpoints
│   │   ├── services/
│   │   │   └── userService.ts                # User business logic
│   │   ├── repositories/
│   │   │   ├── interfaces/
│   │   │   │   └── userRepository.ts         # User repo interface
│   │   │   └── userRepository.ts             # User repo implementation
│   │   ├── models/
│   │   │   └── User.ts                       # User model
│   │   ├── types/
│   │   │   └── user.ts                       # User-specific types
│   │   ├── validators/
│   │   │   └── profileValidator.ts           # Profile validation
│   │   └── routes.ts                         # User routes
│   │
│   ├── sleep/                                # Sleep data feature
│   │   ├── controllers/
│   │   │   └── sleepController.ts            # Sleep endpoints
│   │   ├── services/
│   │   │   ├── sleepService.ts               # Sleep business logic
│   │   │   └── sleepSummaryService.ts        # Summary generation
│   │   ├── repositories/
│   │   │   ├── interfaces/
│   │   │   │   └── sleepDataRepository.ts    # Sleep repo interface
│   │   │   └── sleepDataRepository.ts        # Sleep repo implementation
│   │   ├── models/
│   │   │   ├── SleepData.ts                  # Sleep data model
│   │   │   └── SleepSummary.ts               # Sleep summary model
│   │   ├── types/
│   │   │   └── sleep.ts                      # Sleep-specific types
│   │   ├── external/
│   │   │   └── ouraClient.ts                 # Oura API integration
│   │   ├── validators/
│   │   │   ├── dateValidator.ts              # Date validation
│   │   │   └── sleepNoteValidator.ts         # Sleep note validation
│   │   └── routes.ts                         # Sleep routes
│   │
│   ├── competition/                          # Competition feature
│   │   ├── controllers/
│   │   │   └── competitionController.ts      # Competition endpoints
│   │   ├── services/
│   │   │   ├── competitionService.ts         # Competition business logic
│   │   │   └── leaderboardService.ts         # Leaderboard generation
│   │   ├── repositories/
│   │   │   ├── interfaces/
│   │   │   │   ├── competitionRepository.ts  # Competition repo interface
│   │   │   │   └── leaderboardRepository.ts  # Leaderboard repo interface
│   │   │   ├── competitionRepository.ts      # Competition repo implementation
│   │   │   └── leaderboardRepository.ts      # Leaderboard repo implementation
│   │   ├── models/
│   │   │   ├── Competition.ts                # Competition model
│   │   │   └── Leaderboard.ts                # Leaderboard model
│   │   ├── types/
│   │   │   └── competition.ts                # Competition-specific types
│   │   ├── validators/
│   │   │   └── competitionValidator.ts       # Competition validation
│   │   └── routes.ts                         # Competition routes
│   │
│   ├── notification/                         # Notification feature
│   │   ├── controllers/
│   │   │   └── notificationController.ts     # Notification endpoints
│   │   ├── services/
│   │   │   └── notificationService.ts        # Notification business logic
│   │   ├── repositories/
│   │   │   ├── interfaces/
│   │   │   │   └── notificationRepository.ts # Notification repo interface
│   │   │   └── notificationRepository.ts     # Notification repo implementation
│   │   ├── models/
│   │   │   └── Notification.ts               # Notification model
│   │   ├── types/
│   │   │   └── notification.ts               # Notification-specific types
│   │   ├── validators/
│   │   │   └── notificationValidator.ts      # Notification validation
│   │   └── routes.ts                         # Notification routes
│   │
│   └── invitation/                           # Invitation feature
│       ├── controllers/
│       │   └── invitationController.ts       # Invitation endpoints
│       ├── services/
│       │   └── invitationService.ts          # Invitation business logic
│       ├── repositories/
│       │   ├── interfaces/
│       │   │   └── invitationRepository.ts   # Invitation repo interface
│       │   └── invitationRepository.ts       # Invitation repo implementation
│       ├── models/
│       │   └── Invitation.ts                 # Invitation model
│       ├── types/
│       │   └── invitation.ts                 # Invitation-specific types
│       ├── validators/
│       │   └── invitationValidator.ts        # Invitation validation
│       └── routes.ts                         # Invitation routes
│
├── index.ts                                  # Application entry point
│
└── tests/                                    # Tests
    ├── integration/                          # Integration tests
    ├── unit/                                 # Unit tests
    │   ├── features/                         # Test features
    │   │   ├── auth/
    │   │   ├── user/
    │   │   └── ...
    │   └── shared/                           # Test shared modules
    └── mocks/                                # Test mocks


