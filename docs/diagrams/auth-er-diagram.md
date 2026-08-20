# Authentication — ER Diagram

Scope: only the entities/fields relevant to the Authentication module. `User`
has many more fields/relations used by other modules (Booking, Wallet,
etc.) — omitted here for clarity.

```mermaid
erDiagram
    USER ||--o{ REFRESH_TOKEN : "has"
    USER ||--o{ LOGIN_EVENT : "has"

    USER {
        string id PK
        string phone UK "nullable"
        string email UK "nullable"
        string passwordHash "nullable"
        string name
        enum role "CUSTOMER|PROVIDER|ADMIN"
        boolean isVerified
        boolean isGuest
        boolean isSuspended
        enum authProvider "PHONE|EMAIL|GOOGLE|APPLE|FACEBOOK|GUEST"
        string googleId UK "nullable"
        string appleId UK "nullable"
        string facebookId UK "nullable"
        string referralCode UK
        string referredById FK "nullable, self-ref"
        datetime createdAt
    }

    REFRESH_TOKEN {
        string id PK
        string tokenHash UK "sha256, never the raw token"
        string userId FK
        datetime expiresAt
        datetime revokedAt "nullable"
        string replacedByTokenId "nullable, rotation chain"
        string ipAddress "nullable"
        string userAgent "nullable"
        datetime createdAt
    }

    LOGIN_EVENT {
        string id PK
        string userId FK
        enum provider "PHONE|EMAIL|GOOGLE|APPLE|FACEBOOK|GUEST"
        string ipAddress "nullable"
        string userAgent "nullable"
        datetime createdAt
    }
```

**নোট:**
- OTP নিজে কোনো table না — Redis-এ থাকে (`otp:hash:{phone}`, `otp:attempts:{phone}`), TTL দিয়ে auto-expire হয়, তাই ER diagram-এ নেই।
- `RefreshToken` স্বয়ংসম্পূর্ণ audit trail: `replacedByTokenId` দিয়ে পুরো rotation chain ট্রেস করা যায়, token theft হলে কোন chain থেকে হয়েছে বোঝা যাবে।
