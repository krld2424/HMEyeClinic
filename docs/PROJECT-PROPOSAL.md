# PROJECT PROPOSAL AND SYSTEM DOCUMENTATION
## HM VisionSync

**Prepared for:** Hernandez Mercado Eye Clinic  
**Prepared by:** Development Team  
**Date:** August 26, 2026  
**Document basis:** Source-code scan of the HM VisionSync workspace

> This document describes the implementation found in the scanned workspace. Features identified as partial, referenced, or not found are explicitly labeled and are not presented as completed capabilities.

## 1. Introduction

HM VisionSync is a web-based clinic access and workflow system for Hernandez Mercado Eye Clinic in Santa Rosa, Nueva Ecija. The workspace contains a public clinic website, an Astro-based authenticated portal, and an Express API backed by MongoDB.

The implemented system centralizes patient account registration, sign-in, password recovery, appointment requests, appointment availability, appointment status handling, follow-up requests, clinical records, prescriptions represented as clinical records, owner account administration, clinic settings, and audit visibility. The source code does not provide enough evidence to characterize the clinic's pre-system manual procedures; therefore, this proposal does not claim a specific existing manual workflow.

The project addresses the practical need for a single web entry point for clinic information and authenticated workflows. It provides separate role experiences, protected API operations, persistent data models, and deployment configuration for local development and hosted environments.

## 2. Project Objectives

The current implementation supports these objectives:

- Provide a public digital presence for clinic services, eyewear, contact information, and clinic content.
- Allow patients to register and access a personal clinic workspace.
- Allow patients to request appointments and view appointment status.
- Give clinic staff appointment availability and status-management tools.
- Store and retrieve clinical records, consultation notes, medical records, and prescriptions.
- Support follow-up requests and staff follow-up status updates.
- Allow the Owner to manage staff accounts and clinic settings.
- Provide role-restricted access to patient, clinical, and administrative data.
- Record selected administrative and appointment-status activities for accountability.
- Provide password recovery through email OTP verification.

## 3. Actual User Roles

The `User` model and authorization middleware confirm four roles: `patient`, `owner`, `optometrist`, and `eye-care-assistant`. There is no separate active `superadmin` role in the schema. The provisioning utility migrates a legacy `superadmin` value to `owner` and creates the configured administrative account with the `owner` role.

### 3.1 Owner

The Owner is the highest-privilege implemented role. Owner-only API access includes:

- Viewing managed user accounts, excluding Owner accounts from the returned list.
- Creating optometrist and eye care assistant accounts.
- Activating or deactivating non-owner accounts.
- Viewing the static role-permission summary.
- Viewing combined audit information.
- Reading and updating clinic settings.
- Accessing owner dashboard, appointment, clinical, follow-up, management, reports, audit-log, and settings routes exposed by the frontend.
- Using the clinical and appointment workflows available to the clinical roles.

The implementation does not provide an editable permission matrix. The Roles & Permissions page displays a static summary returned by the API.

### 3.2 Optometrist

The Optometrist can:

- View clinic appointments.
- Change appointment status.
- View clinical records.
- Create clinical records with types such as consultation, prescription, clinical note, and medical record.
- Update clinical records.
- View and manage follow-up requests.
- Use the optometrist dashboard, today's patients, appointments, consultations, clinical records, prescriptions, and follow-up routes.

The clinical API authorizes the role but does not implement assignment-based patient restrictions. The role cannot use Owner-only administration endpoints.

### 3.3 Eye Care Assistant

The Eye Care Assistant can:

- View clinic appointments.
- Change appointment status.
- Use the scheduling and operational dashboard routes exposed for the role.
- View the frontend routes labeled Patient Check-In, Clinic Queue, Patient Records, and Billing.

The backend does not provide dedicated check-in, queue, patient-record-search, billing, payment, or transaction endpoints. Those operational routes are therefore partial or placeholder surfaces rather than completed modules.

### 3.4 Patient

The Patient can:

- Register as a patient account.
- Sign in and receive a JWT.
- View only their own appointments through the protected `/api/appointments/mine` endpoint.
- Book an appointment from the authenticated dashboard.
- Check appointment availability.
- View their own clinical records, medical records, and prescriptions.
- Submit and view their own follow-up requests.
- View and update their profile information.
- Receive derived dashboard notifications based on appointment and follow-up data.

Patient registration always assigns the `patient` role and generates a patient identifier in the `HME-######` format.

## 4. Core System Features

### 4.1 Public Clinic Website

The public Astro homepage contains clinic branding, navigation, an eye-care introduction, services, examination steps, eyewear highlights, reasons to choose the clinic, contact/booking content, and links to login, registration, and the eyewear catalog. Content is primarily defined in frontend page data, with a backend content endpoint exposing the `clinicContent` configuration.

### 4.2 Authentication and Password Recovery

Authentication is implemented with email and password login. Passwords are hashed with `bcryptjs`. Successful login returns a seven-day JWT containing the user ID, role, and email. The frontend stores the token and user summary in `localStorage` and sends the token as a Bearer authorization header for protected API calls.

Patient registration validates required identity, contact, and password fields in the browser and backend. The backend normalizes email addresses, prevents duplicate email accounts, assigns the patient role, and creates a patient ID.

Password recovery is implemented as three separate frontend pages:

- `/reset-password` accepts the account email and requests an OTP.
- `/reset-password/code` accepts six OTP digits, displays the ten-minute countdown, and supports resend.
- `/reset-password/new-password` accepts the new password and confirmation.

The backend generates a random six-digit OTP, stores its SHA-256 hash, allows five OTP attempts through rate limiting/attempt tracking, and issues a short-lived reset token after successful verification. The reset token is also stored only as a hash and expires after ten minutes. The frontend carries reset state in `sessionStorage`.

### 4.3 Appointment and Booking Management

The public booking form can submit an appointment without authentication. Authenticated patients can book from the dashboard. The implementation provides:

- Fixed appointment slots: 09:00 AM, 10:30 AM, 01:00 PM, 02:30 PM, and 04:00 PM.
- Availability lookup by date.
- Browser and backend checks against past dates.
- Conflict detection for active appointments using the date/time pair.
- New appointments with default `pending` status.
- Patient appointment history restricted to the patient's account or email.
- Staff appointment listing and status updates.
- Status values: `pending`, `confirmed`, `completed`, `cancelled`, `rescheduled`, and `no-show`.
- Search, status/date filters, pagination, and calendar presentation in dashboard pages.

Appointment email notification code exists through optional SMTP configuration. If SMTP is not configured, notifications are skipped.

### 4.4 Follow-Up Requests

Patients can submit follow-up requests with a reason and optional preferred date. The backend rejects past preferred dates, stores the patient identity, and starts the request at `requested` status.

Owner and Optometrist users can list follow-ups and update status, scheduled date, and notes. Supported statuses are `requested`, `scheduled`, `completed`, `rejected`, and `cancelled`. The frontend provides filtering, pagination, and staff actions.

### 4.5 Clinical Records and Prescriptions

The `ClinicalRecord` model stores records linked to a patient and author. Supported types are `medical-record`, `clinical-note`, `consultation`, and `prescription`. Records include title, details, status, issue date, author, patient reference, and timestamps.

Patients can view their own records. Owners and Optometrists can list, create, and update clinical records. The frontend uses the same record mechanism for consultation, clinical-record, medical-record, and prescription views. There is no separate prescription collection or dispensing workflow.

### 4.6 Patient Profile

Patients can retrieve and update their name, phone, age, and gender through protected workspace endpoints. Email is displayed in the profile form but is not editable through the implemented profile update endpoint.

### 4.7 User Management

Owner-only administration supports:

- Listing non-owner accounts.
- Assigning missing patient IDs during account listing.
- Creating optometrist and eye care assistant accounts.
- Validating phone format.
- Activating or deactivating non-owner accounts.
- Searching and filtering accounts in the frontend.

The implementation does not expose an Owner account-management UI or delete-account operation.

### 4.8 Clinic Settings

Owner-only settings provide a singleton clinic settings document with name, phone, email, address, hours, and services fields. The frontend currently edits name, phone, email, address, and hours. Updating settings creates an audit-log entry.

### 4.9 Notifications

A dashboard notification popover is implemented as a derived frontend view. It builds notifications from pending/confirmed appointments and requested/scheduled follow-ups, marks them read in browser `localStorage`, and displays up to five unread items.

There is no Notification MongoDB model or notification API. The dedicated patient Notifications route is therefore only partially implemented as a derived dashboard presentation.

### 4.10 Eyewear Catalog

The public eyewear page displays collections for contact lenses and glasses, reading glasses, sunglasses, accessories, and Anti-Rad products. It includes product descriptions, prices, sizes, image URLs, color swatches, and client-side image color filters. There is no product database, cart, checkout, inventory, or order API.

## 5. Website and Content Management

A public `GET /api/content` endpoint returns static clinic content from `backend/config/clinicContent.js`, including navigation labels, services, and a gallery. The frontend homepage and eyewear page also contain page-specific content directly.

No authenticated content-management interface, create/update/delete content API, publishing workflow, or content audit trail was found. Content management is therefore **partially implemented** as read-only/static content exposure.

## 6. Reports and Analytics

The Owner dashboard includes a route labeled Reports, and the sidebar includes a Reports link. No dedicated report endpoint, aggregation service, chart data API, export function, or report model was found. The route is a placeholder/extension point and reporting is **not implemented**.

The system does provide basic list counts and filtered tables in dashboard pages, but these are operational views rather than an implemented analytics module.

## 7. Audit Log

The `AuditLog` model records:

- `actorId`, referencing the User who performed an action.
- Action description.
- Target description.
- Optional details.
- Previous data.
- New data.
- Created and updated timestamps.

Appointment status changes create audit records containing the previous and new status. Clinic settings updates create an audit record identifying the settings target. The Owner audit endpoint also derives historical appointment-status entries from appointment timestamps and combines them with stored audit records. The frontend provides search, module/date filters, pagination, actor information, action, target, status display, and previous/new data display.

Fictional example:

> On 26 August 2026, an Owner changed a fictional appointment from `pending` to `confirmed`. The record identifies the actor role, appointment-management module, target, timestamp, previous status, and new status.

The audit implementation is selective, not a complete immutable event ledger for every API action.

## 8. User and Access Management

The backend uses role-based middleware. `requireAuth` validates a Bearer JWT, and `allowRoles` restricts endpoints to declared roles. Owner routes apply Owner authorization at router level. Clinical routes allow Owner and Optometrist users. Patient routes require the patient role. Appointment operational routes allow Owner, Optometrist, and Eye Care Assistant users.

Account creation includes public patient registration and Owner-only staff creation. Account activation/deactivation is supported for non-owner accounts. Role assignment is controlled by backend logic: public registration creates patients, while Owner creation is limited to optometrist and eye-care-assistant roles.

The frontend uses role-specific static dashboard paths and redirects, but these redirects are not the security boundary; backend middleware performs the actual authorization.

## 9. Actual System Workflow

The implemented workflow is:

```text
Public clinic website
        |
        +--> Patient registration --> bcrypt password hash --> patient account and patient ID
        |
        +--> Login --> seven-day JWT --> role dashboard
        |
        +--> Public appointment request

Authenticated patient
        |
        +--> Check appointment availability
        |
        +--> Submit appointment request --> pending appointment
        |
        +--> View own appointments and status
        |
        +--> Submit follow-up request --> requested follow-up
        |
        +--> View own clinical records and prescriptions

Owner / Optometrist / Eye Care Assistant
        |
        +--> View operational appointments
        +--> Update appointment status
        +--> Appointment status changes create audit entries

Owner / Optometrist
        |
        +--> Create or update clinical records
        +--> Review follow-up requests
        +--> Schedule, complete, reject, or cancel follow-ups

Owner
        |
        +--> Create and manage staff accounts
        +--> Update clinic settings
        +--> Review permissions summary and audit view
```

A complete check-in-to-payment workflow is not implemented. The source code supports appointment requests, staff status updates, clinical records, follow-ups, and selected audit activity, but not a verified cashiering or payment transition.

## 10. Technology Stack

- **Frontend:** Astro 7.x, static output, JavaScript in `.astro` pages, CSS in `frontend/src/styles.css`.
- **Backend:** Node.js with Express 4.x.
- **Database:** MongoDB using Mongoose 8.x. Local MongoDB is supported through `mongodb://127.0.0.1:27017/hm_visionsync`; MongoDB Atlas is supported through an `mongodb+srv://...` URI.
- **Authentication:** JSON Web Tokens with `jsonwebtoken`; password hashing with `bcryptjs`.
- **Email:** Resend for password-reset OTP email; Nodemailer/SMTP for optional appointment notifications.
- **Rate limiting:** `express-rate-limit` for general API, login, registration, appointment creation, forgot-password, and OTP requests.
- **Icons:** `@lucide/astro` for sidebar icons.
- **Frontend hosting configuration:** Vercel configuration points to `frontend/dist` and uses Astro.
- **Backend hosting configuration:** Render configuration builds and starts the backend service and exposes `/api/health` as its health check.
- **External media:** Public pages use remote Unsplash image URLs.

## 11. System Architecture

```text
User browser
    |
    v
Astro static frontend
(public site, auth pages, reset pages, dashboards)
    |
    | HTTP / JSON + Bearer JWT
    v
Express.js API
(authentication, appointments, clinical records,
follow-ups, administration, workspace, content)
    |
    v
Mongoose data layer
    |
    v
MongoDB
(local development or MongoDB Atlas production)

External services:
- Resend for password-reset email
- SMTP for optional appointment notifications
- Vercel for frontend hosting
- Render for backend hosting
```

The frontend is statically generated and performs browser-side API calls. The Express server loads environment variables, connects to MongoDB, provisions the Owner account when configured, mounts API routers, and listens on the configured port.

## 12. Security and Accountability

### Implemented Security

- Password hashing with `bcryptjs` before storage.
- JWT authentication with expiration for login sessions.
- Bearer-token verification in backend middleware.
- Role-based API authorization with explicit role allowlists.
- Patient-specific appointment and clinical-record endpoints.
- Owner-only administration, permissions summary, audit, and settings endpoints.
- OTP values stored as SHA-256 hashes rather than plaintext.
- OTP expiry after ten minutes and reset-token expiry after ten minutes.
- OTP attempt tracking and request rate limiting.
- Login, registration, forgot-password, OTP, appointment, and general API rate limits.
- Backend validation for required fields, dates, phone formats, appointment conflicts, enum statuses, and password-reset password policy.
- Generic forgot-password response to avoid directly disclosing whether an email exists.
- Password reset token is returned only after successful OTP verification and stored hashed in MongoDB.
- CORS allowlist configuration, with local frontend origin permitted during development.
- Environment files ignored by Git configuration; secret values are not reproduced in this document.
- HTML escaping in several frontend-generated table views.
- Audit entries for appointment status changes and clinic-settings updates.

### Recommended Security Improvements

- Replace development fallback JWT secrets with a required strong secret in every environment, including development where practical.
- Rotate any credentials that have ever been placed in local or example environment files and verify that no secrets are present in Git history.
- Move authentication tokens from `localStorage` to secure, HttpOnly, SameSite cookies where the deployment model permits.
- Add CSRF protection if cookie-based authentication is introduced.
- Add security headers such as Content Security Policy, HSTS in HTTPS production, and related Express hardening.
- Validate and constrain all request bodies with a shared schema-validation library.
- Enforce authorization based on patient assignment or clinical relationship, not only broad clinical roles.
- Add a dedicated password-reset rate limit to the reset-password endpoint and consider account/IP combined throttling.
- Avoid returning raw database error messages in production responses.
- Add email delivery failure observability and a verified Resend domain for production.
- Make audit records append-only and audit all sensitive record reads and updates.
- Add automated tests for authorization boundaries, OTP lifecycle, status transitions, and input validation.
- Add database backups, restore testing, retention rules, and monitoring.
- Add pagination at API level for large appointment, record, user, and audit datasets.

## 13. Expected Benefits to the Clinic

### Improved Efficiency

Patients can request appointments and follow-ups online, while staff can review and update work from role-specific dashboards.

### Better Record Management

Clinical records, consultations, prescriptions, and follow-up details have persistent MongoDB models rather than being limited to a browser display.

### Improved Patient Experience

Patients receive a public clinic website, account access, appointment status visibility, profile editing, records access, and password recovery.

### Better Accountability

Selected appointment and settings actions are recorded with actor, target, time, and before/after status data.

### Improved Administrative Control

The Owner can provision staff accounts, activate/deactivate managed users, review role access summaries, and update clinic settings.

### Reduced Manual Work

Appointment availability, conflict checks, status updates, follow-up queues, and derived dashboard notices reduce repeated coordination work, although cashiering and full notification management remain outside the current scope.

## 14. Project Scope and Limitations

### Current Scope

- Public clinic website and eyewear catalog.
- Patient registration and login.
- Password reset with Resend OTP.
- Four role dashboards.
- Appointment availability, booking, viewing, filtering, and status updates.
- Follow-up request and management workflow.
- Clinical records and prescription record workflow.
- Patient profile management.
- Owner staff-account management.
- Clinic settings.
- Selected audit-log storage and viewing.
- Local MongoDB and MongoDB Atlas configuration.
- Vercel frontend and Render backend deployment configuration.

### Limitations

- The dashboard contains route labels for functions that do not have dedicated backend implementations.
- Billing is a placeholder route; no payment, cashiering, invoice, or transaction model exists.
- Reports are a placeholder route; no analytics or export API exists.
- Clinic queue and check-in are not backed by dedicated models or APIs.
- Notifications are derived client-side from appointments/follow-ups and are not persistent notification records.
- Content is primarily static; no content administration workflow exists.
- Clinical authorization is role-level and is not assignment-level.
- Appointment and record API lists are not paginated server-side.
- Automated test files were not found in the scanned workspace.
- The frontend uses client-side local/session storage for tokens and reset state.
- Remote image URLs require external network availability.

### Out of Scope in the Current Implementation

- Cashiering and payment processing.
- Transaction and invoice management.
- Inventory and eyewear ordering.
- SMS notifications.
- Mobile-native application.
- Multi-branch clinic operations.
- Insurance claims.
- Advanced reports and exports.
- Full content publishing administration.

## 15. Proposed Future Enhancements

The following are recommendations based on identified gaps and are not implemented features:

- Add dedicated queue and check-in models, endpoints, and status transitions.
- Implement billing, cashiering, invoices, payments, refunds, and transaction history.
- Add server-side reports with date filters, aggregation, charts, and export formats.
- Add persistent notifications with read state stored on the server.
- Add SMS or additional email reminders for appointments and follow-ups.
- Add granular clinical access rules based on appointment assignment or explicit authorization.
- Add a formal content-management interface with versioning and publishing controls.
- Add eyewear inventory, product administration, cart, ordering, and payment workflows.
- Add multi-branch support and branch-specific settings.
- Add automated unit, integration, API-security, and end-to-end tests.
- Add structured request validation and centralized error handling.
- Add observability, alerting, backup automation, and disaster-recovery procedures.

## 16. Development and Deployment

### Local Development

The root scripts run the frontend and backend together using `concurrently`. The frontend runs on port `4321`; the backend runs on port `5000`. Local MongoDB is configured with:

```text
mongodb://127.0.0.1:27017/hm_visionsync
```

The backend can also use an Atlas connection string by setting `MONGODB_URI` accordingly. The backend health endpoint is `/api/health`.

### Environment Configuration

Environment variable names found in the project include:

- `PORT`: backend listening port.
- `CORS_ORIGIN`: permitted frontend origins.
- `MONGODB_URI`: MongoDB connection URI.
- `JWT_SECRET`: JWT signing secret.
- `RESEND_API_KEY`: backend-only Resend API key.
- `MAIL_FROM`: email sender identity.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`: optional SMTP appointment notification configuration.
- `CLINIC_NOTIFICATION_EMAIL`: clinic notification recipient.
- `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`: Owner provisioning configuration.
- `PUBLIC_API_URL`: frontend build-time API base URL.

Actual values are intentionally omitted and treated as confidential.

### Production Deployment

The Render configuration defines a Node web service for the API, uses port `10000`, reads sensitive environment values through the hosting platform, and checks `/api/health`. The Vercel configuration builds the Astro frontend and serves `frontend/dist`.

Production should use HTTPS, a verified Resend sender domain, MongoDB Atlas or another managed MongoDB deployment, a strong JWT secret, a production CORS allowlist, and hosting-platform secret variables.

## 17. Maintenance and Support

- Keep root, backend, and frontend dependencies updated and review breaking changes before deployment.
- Run the frontend production build after route, template, or CSS changes.
- Run Node syntax checks and API tests after backend changes.
- Keep local `.env` files out of Git and maintain sanitized `.env.example` files.
- Monitor MongoDB connection health, storage, indexes, backups, and restore procedures.
- Review rate-limit behavior and authentication logs after security changes.
- Add new roles and permissions in both the authorization middleware and role-specific frontend navigation only after defining the backend contract.
- Extend the relevant Mongoose model and API route together when adding a persistent feature.
- Update audit behavior when adding sensitive administrative actions.
- Verify `CORS_ORIGIN` and `PUBLIC_API_URL` for each deployment environment.
- Use staged deployment and smoke tests for login, appointment booking, records, follow-ups, and password reset.

## 18. Conclusion

HM VisionSync currently provides a functional foundation for Hernandez Mercado Eye Clinic's public web presence and authenticated clinic workflows. Its strongest implemented areas are account access, role-restricted dashboards, appointment handling, follow-up management, clinical-record storage, Owner administration, clinic settings, selected audit visibility, and email OTP password recovery.

The system is not yet a complete end-to-end clinic management suite. Billing, cashiering, queue/check-in operations, advanced reporting, persistent notifications, and administrative content management require additional implementation. With those enhancements, stronger granular clinical authorization, automated testing, production secret rotation, and operational monitoring, HM VisionSync can mature into a broader clinic operations platform while preserving the current Astro, Express, and MongoDB architecture.

## 19. Project Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Public clinic website | Implemented | Homepage, clinic information, services, contact content, and links are present. |
| Eyewear catalog | Implemented | Static collections, product display, color swatches, and image filters; no ordering or inventory. |
| Authentication | Implemented | Registration, login, bcrypt password hashing, JWT, and role checks are present. |
| Password reset / Email OTP | Implemented | Resend email, hashed six-digit OTP, ten-minute expiry, reset token, and three frontend pages. |
| Patient management | Partially Implemented | Registration, patient IDs, profile, and patient-scoped records/appointments exist; no comprehensive patient administration module. |
| Appointment management | Implemented | Availability, booking, conflict checks, status transitions, filters, and role restrictions exist. |
| Follow-up management | Implemented | Patient requests and Owner/Optometrist status/scheduling updates are supported. |
| Clinical records | Implemented | MongoDB model and protected list/create/update endpoints exist for clinical record types. |
| Prescription management | Partially Implemented | Prescriptions are represented as `ClinicalRecord` type; no separate prescription or dispensing workflow. |
| Eye examination workflow | Partially Implemented | Consultation and clinical-record forms exist; no specialized examination schema or structured findings model. |
| Clinic queue | Planned / Referenced | Frontend navigation and placeholder copy exist; no queue model or API was found. |
| Patient check-in | Planned / Referenced | Frontend route label exists; no dedicated implementation was found. |
| Cashiering | Not Found | Billing label exists in navigation, but no cashiering or payment implementation was found. |
| Payments / transactions | Not Found | No payment provider, transaction model, invoice API, or checkout workflow was found. |
| Notifications | Partially Implemented | Client-side derived appointment/follow-up notices exist; no persistent notification model/API. |
| Appointment email notifications | Partially Implemented | Optional SMTP mailer exists; skipped when SMTP is not configured. |
| Website content management | Partially Implemented | Static content configuration and public read endpoint exist; no admin editing/publishing workflow. |
| User management | Implemented | Owner can create managed roles and activate/deactivate non-owner accounts. |
| Roles and permissions | Partially Implemented | Backend role enforcement exists; Owner page returns a static permission summary, not editable permissions. |
| Audit logs | Partially Implemented | Stored logs cover appointment status and clinic settings; Owner combined view exists, but coverage is not universal. |
| Reports and analytics | Planned / Referenced | Owner Reports route exists, but no report API, aggregation, charts, or exports were found. |
| Clinic settings | Implemented | Owner can read/update singleton clinic settings; updates create audit entries. |
| Local MongoDB | Implemented | Development fallback and explicit local URI are supported. |
| MongoDB Atlas | Implemented | `mongodb+srv://...` connection configuration is supported for hosted environments. |
| Vercel frontend deployment | Implemented | Vercel config targets Astro static output in `frontend/dist`. |
| Render backend deployment | Implemented | Render service config includes Node build/start commands and health check. |
| Automated tests | Not Found | No test suite or test files were found in the scanned project. |
