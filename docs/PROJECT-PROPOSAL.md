# PROJECT PROPOSAL AND SYSTEM DOCUMENTATION
## HM VisionSync

**Prepared for:** Hernandez Mercado Eye Clinic  
**Prepared by:** Development Team  
**Date:** August 30, 2026 (Updated)  
**Document basis:** Source-code scan of the HM VisionSync workspace

> This document describes the implementation found in the scanned workspace. Features identified as partial, referenced, or not found are explicitly labeled and are not presented as completed capabilities.

## 1. Introduction

HM VisionSync is a web-based clinic access and workflow system for Hernandez Mercado Eye Clinic in Santa Rosa, Nueva Ecija. The workspace contains a public clinic website, an Astro-based authenticated portal, and an Express API backed by MongoDB.

The implemented system centralizes patient account registration, sign-in, password recovery, appointment requests, appointment availability, appointment status handling, follow-up requests, clinical records, prescriptions represented as clinical records, owner account administration, clinic settings, and audit visibility. The system also provides comprehensive billing and invoicing functionality with customizable templates, payment recording and reversal, inventory and supplier management for operational tracking, and audit logging for accountability.

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
- Create professional customizable invoices and manage billing workflows.
- Record and track customer payments with reversal capability for corrections.
- Maintain supplier relationships and track purchase orders.
- Track inventory levels and movements with automatic quantity updates.
- Provide billing summaries and outstanding balance reporting.

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
- Creating and managing suppliers with contact information.
- Creating purchase orders linked to suppliers.
- Recording received goods and tracking inventory receiving.
- Creating and managing inventory items with SKU tracking.
- Recording inventory movements (stock-in, stock-out, stock-adjustment).
- Creating customizable invoice templates with visual layout editor.
- Creating itemized invoices with auto-calculated totals and tax.
- Recording customer payments against invoices.
- Reversing payments with reason documentation.
- Cancelling invoices (only after reversing all payments).
- Sending payment reminder emails for unpaid invoices.
- Viewing billing summaries with totals for invoiced, paid, outstanding, and overdue amounts.
- Accessing owner dashboard, appointment, clinical, follow-up, management, reports, audit-log, settings, supplier, inventory, and billing routes exposed by the frontend.
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

The public booking form can submit an appointment without authentication. Authenticated patients can book from the dashboard. The clinic's official operating schedule is enforced throughout the system:

**Clinic Operating Hours:**
- Monday to Friday: 9:00 AM – 6:00 PM
- Saturday: 8:30 AM – 5:30 PM
- Sunday: By Appointment Only (special requests require contacting the clinic directly)

The implementation provides:

- **Dynamic appointment slots** based on clinic operating hours for the selected date.
- **Day-of-week schedule enforcement** with different hour ranges for weekdays, Saturday, and Sunday.
- **Centralized clinic schedule configuration** in `backend/config/clinicSchedule.js` with functions for schedule lookup, time validation, and formatting.
- **Availability lookup by date** that returns only slots within the clinic's operating hours for that specific day.
- **Browser and backend checks** against past dates and times outside clinic hours.
- **Conflict detection** for active appointments using the date/time pair to ensure no double-booking.
- **Sunday handling** with special messaging ("By Appointment Only") when users select Sunday.
- **New appointments with default `pending` status**.
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

### 4.8 Invoice Templates

The system provides a complete invoice template builder for Owner users. Templates support customizable elements with precise positioning, sizing, and styling. Key features include:

- **Configurable paper sizes**: A4, Letter, and Legal formats.
- **Orientation options**: Portrait and landscape.
- **Element types**: Text, headings, images, dividers, lines, spacers, signatures, footers, fields, customer blocks, item tables, total summaries, payment blocks, and shapes.
- **Dynamic fields**: Templates can reference business information (name, address, contact, email, logo), invoice details (number, date, due date), customer information, itemized services/products, subtotals, discounts, taxes, totals, paid amounts, outstanding balances, payment methods, and dates.
- **Default template**: The system auto-creates a professional default template if none exists.
- **Template management**: Owners can retrieve, update, and view templates.
- **Audit trail**: Template creation and updates are tracked.

Invoices link to templates by reference and store a snapshot of the template data at invoice creation time.

### 4.9 Billing, Invoicing, and Cashiering

The system provides a complete billing and invoicing workflow owned by Owner-only authorization. Key features include:

- **Invoice creation**: Owners can create itemized invoices for patients or named customers with optional patient ID tracking.
- **Invoice items**: Each invoice line includes description, quantity, unit price, discount, and tax calculations.
- **Auto-calculated totals**: The system automatically calculates line totals, invoice subtotals, totals after discount, and final amounts including tax.
- **Invoice numbering**: Auto-generated invoice numbers with INV-YYYY-NNNN format.
- **Invoice templates**: Invoices associate with customizable invoice templates for consistent professional formatting.
- **Invoice status tracking**: Invoices progress through statuses: `unpaid`, `partially-paid`, `paid`, `overdue`, and `cancelled`.
- **Overdue tracking**: The system tracks and displays days overdue based on configured due dates.
- **Payment recording**: Owners record patient payments against invoices with payment method, receipt number, and date.
- **Partial payments**: Invoices accept multiple payments, tracking amount paid, remaining balance, and payment status.
- **Payment reversal**: Recorded payments can be reversed with reason documentation, updating invoice status accordingly.
- **Invoice cancellation**: Invoices can be cancelled only after all payments are reversed.
- **Payment reminders**: Owners can send email payment reminders to customers for unpaid and partially-paid invoices via Resend.
- **Billing summary**: A summary endpoint provides totals for invoiced amounts, collected payments, outstanding balances, overdue amounts, and invoice status counts.
- **Audit logging**: All invoice creation, updates, cancellations, payment recordings, reversals, and reminders create audit records.

### 4.10 Inventory and Supplier Management

The system provides inventory tracking and supplier management for Owner users. Key features include:

- **Suppliers**: Owners can create and manage supplier records with name, contact information, phone, email, and address.
- **Purchase orders**: Owners can create purchase orders linked to suppliers with itemized products.
- **Inventory items**: Owners can create inventory items with name, SKU, and quantity tracking.
- **Receiving**: Owners can record received goods from purchase orders, automatically updating inventory quantities.
- **Stock movements**: The system supports four inventory change types with automatic quantity adjustments:
  - **Stock-in**: Add stock to inventory.
  - **Stock-out**: Remove stock from inventory.
  - **Receiving**: Add received goods from suppliers.
  - **Stock-adjustment**: Correct inventory quantity to match physical counts.
- **Inventory tracking**: The system maintains current stock levels and prevents stock-out operations that would result in negative quantities.
- **Operation history**: All stock movements are recorded with timestamps, reference numbers, and creator information.
- **Audit logging**: All supplier and inventory operations create audit records.

### 4.11 Clinic Settings

Owner-only settings provide a singleton clinic settings document with name, phone, email, address, hours, and services fields. The frontend currently edits name, phone, email, address, and hours. Updating settings creates an audit-log entry.

### 4.12 Notifications

A dashboard notification popover is implemented as a derived frontend view. It builds notifications from pending/confirmed appointments and requested/scheduled follow-ups, marks them read in browser `localStorage`, and displays up to five unread items.

There is no Notification MongoDB model or notification API. The dedicated patient Notifications route is therefore only partially implemented as a derived dashboard presentation.

### 4.13 Eyewear Catalog

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

Appointment status changes create audit records containing the previous and new status. Clinic settings updates create an audit record identifying the settings target. Invoice, payment, supplier, purchase order, and inventory operations create comprehensive audit records with before/after data. The Owner audit endpoint also derives historical appointment-status entries from appointment timestamps and combines them with stored audit records. The frontend provides search, module/date filters, pagination, actor information, action, target, status display, and previous/new data display.

Fictional example: On 26 August 2026, an Owner changed a fictional appointment from `pending` to `confirmed`. The record identifies the actor role, appointment-management module, target, timestamp, previous status, and new status.

The audit implementation is selective, not a complete immutable event ledger for every API action.

## 8. User and Access Management

The backend uses role-based middleware. `requireAuth` validates a Bearer JWT, and `allowRoles` restricts endpoints to declared roles. Owner routes apply Owner authorization at router level. Clinical routes allow Owner and Optometrist users. Patient routes require the patient role. Appointment operational routes allow Owner, Optometrist, and Eye Care Assistant users.

Account creation includes public patient registration and Owner-only staff creation. Account activation/deactivation is supported for non-owner accounts. Role assignment is controlled by backend logic: public registration creates patients, while Owner creation is limited to optometrist and eye-care-assistant roles.

The frontend uses role-specific static dashboard paths and redirects, but these redirects are not the security boundary; backend middleware performs the actual authorization.

## 9. Actual System Workflow

The implemented workflows include:

### Public Access & Patient Registration
```text
Public clinic website
        |
        +--> Patient registration --> bcrypt password hash --> patient account and patient ID
        |
        +--> Login --> seven-day JWT --> role dashboard
        |
        +--> Public appointment request
```

### Patient Care Workflow
```text
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
```

### Clinical Staff Workflow
```text
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
```

### Owner Administrative Workflow
```text
Owner
        |
        +--> Create and manage staff accounts (optometrist, eye care assistant)
        |
        +--> Update clinic settings
        |
        +--> Review permissions summary and audit view
        |
        +--> Manage supplier relationships
        |
        +--> Process purchase orders and receiving
        |
        +--> Track inventory levels
        |
        +--> Create customized invoice templates
        |
        +--> Issue invoices and track customer invoicing
        |
        +--> Record and process customer payments
        |
        +--> Send payment reminders
        |
        +--> View billing summary and outstanding balances
```

The source code now supports a complete appointment-to-invoice workflow including appointment requests, clinical records, follow-ups, invoicing, payment recording, inventory management, and audit logging.

## 10. Technology Stack

- **Frontend:** Astro 7.x, static output, JavaScript in `.astro` pages, CSS in `frontend/src/styles.css`.
- **Backend:** Node.js with Express 4.x.
- **Database:** MongoDB using Mongoose 8.x. Local MongoDB is supported through `mongodb://127.0.0.1:27017/hm_visionsync`; MongoDB Atlas is supported through an `mongodb+srv://...` URI.
- **Authentication:** JSON Web Tokens with `jsonwebtoken`; password hashing with `bcryptjs`.
- **Email:** Resend for password-reset OTP email and payment reminders; Nodemailer/SMTP for optional appointment notifications.
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
follow-ups, administration, workspace, content,
billing, invoicing, inventory, suppliers)
    |
    v
Mongoose data layer
    |
    v
MongoDB
(local development or MongoDB Atlas production)

External services:
- Resend for password-reset email and payment reminders
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
- Owner-only administration, permissions summary, audit, settings, invoicing, inventory, and supplier endpoints.
- OTP values stored as SHA-256 hashes rather than plaintext.
- OTP expiry after ten minutes and reset-token expiry after ten minutes.
- OTP attempt tracking and request rate limiting.
- Login, registration, forgot-password, OTP, appointment, and general API rate limits.
- Backend validation for required fields, dates, phone formats, appointment conflicts, enum statuses, password-reset password policy, invoice amounts, and payment amounts.
- Generic forgot-password response to avoid directly disclosing whether an email exists.
- Password reset token is returned only after successful OTP verification and stored hashed in MongoDB.
- CORS allowlist configuration, with local frontend origin permitted during development.
- Environment files ignored by Git configuration; secret values are not reproduced in this document.
- HTML escaping in several frontend-generated table views.
- Comprehensive audit entries for appointment status changes, clinic settings updates, invoicing operations, payment transactions, and inventory movements.
- Inventory lock during stock operations to prevent concurrent modification conflicts.
- Payment and invoice deletion restrictions to maintain data integrity and audit trails.

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
- Add pagination at API level for large appointment, record, user, audit, and operation datasets.
- Implement invoice and payment encryption for sensitive financial data.
- Add PCI compliance review for payment handling if accepting card payments in the future.

## 13. Expected Benefits to the Clinic

### Improved Efficiency

Patients can request appointments and follow-ups online, while staff can review and update work from role-specific dashboards. Owners can manage invoicing and inventory in a centralized system, reducing manual paperwork.

### Better Record Management

Clinical records, consultations, prescriptions, follow-up details, and financial transactions have persistent MongoDB models rather than being limited to a browser display or paper files.

### Improved Patient Experience

Patients receive a public clinic website, account access, appointment status visibility, profile editing, records access, and password recovery.

### Better Accountability

Selected appointment, settings, invoicing, inventory, and payment actions are recorded with actor, target, time, and before/after status data for compliance and audit purposes.

### Improved Administrative Control

The Owner can provision staff accounts, activate/deactivate managed users, review role access summaries, update clinic settings, manage suppliers and purchase orders, track inventory, and oversee billing.

### Reduced Manual Work

Appointment availability, conflict checks, status updates, follow-up queues, invoice generation with auto-calculated totals, payment tracking, and derived dashboard notices reduce repeated coordination work.

### Better Financial Management

Invoice templates provide professional, consistent formatting. Automated invoice numbering, status tracking, and payment reminders improve revenue collection. Payment reversal and audit trails support financial reconciliation.

## 14. Project Scope and Limitations

### Current Scope

- Public clinic website and eyewear catalog.
- Patient registration and login.
- Password reset with Resend OTP.
- Four role dashboards with role-specific functionality.
- Appointment availability, booking, viewing, filtering, and status updates.
- Follow-up request and management workflow.
- Clinical records and prescription record workflow.
- Patient profile management.
- Owner staff-account management.
- Clinic settings.
- Complete billing and invoicing system with customizable templates.
- Payment recording, reversal, and reminder functionality.
- Supplier and purchase order management.
- Inventory tracking with stock movement support.
- Selected audit-log storage and viewing.
- Local MongoDB and MongoDB Atlas configuration.
- Vercel frontend and Render backend deployment configuration.

### Limitations

- Inventory change operations (stock-in, stock-out, stock-adjustment) cannot be edited after creation; they must be corrected with a new offsetting operation.
- Payments cannot be edited; they must be reversed and re-recorded.
- Invoices with recorded payments cannot be deleted; payments must be reversed first.
- Stock-adjustment operations cannot be reversed through deletion; they require a new adjustment operation.
- Payment reminders are sent via email if Resend is configured; without Resend, payment reminders cannot be sent.
- Clinical authorization is role-level and is not assignment-level (any optometrist can see any patient's records).
- Eyewear catalog lacks shopping cart, checkout, and inventory integration.
- Notifications are derived client-side from appointments/follow-ups and are not persistent server-side notification records.
- Content is primarily static; no content administration workflow exists for dynamic pages.
- Appointment and record API lists are not paginated server-side.
- Automated test files were not found in the scanned workspace.
- The frontend uses client-side local/session storage for tokens and reset state.
- Remote image URLs require external network availability.
- Eye Care Assistant role has limited operational routing but lacks dedicated backend implementations for check-in, queue, and billing operations.

### Out of Scope in the Current Implementation

- Shopping cart and ecommerce checkout for eyewear products.
- Eyewear inventory integration with ordering workflow.
- SMS notifications.
- Mobile-native application.
- Multi-branch clinic operations.
- Insurance claims processing.
- Advanced reports and exports beyond basic totals.
- Full content publishing administration interface.
- Granular clinical access rules based on appointment assignment.

## 15. Proposed Future Enhancements

The following are recommendations based on identified gaps and are not currently implemented features:

- Add dedicated queue and check-in models, endpoints, and status transitions with Eye Care Assistant ownership.
- Implement advanced billing features: credit memos, refunds, partial refunds, service packages, and discounts.
- Add server-side reports with date filters, aggregation, charts, export formats (PDF, CSV), and scheduled reporting.
- Add persistent notifications with read state stored on the server and mobile push notification support.
- Add SMS or additional email reminders for appointments and follow-ups.
- Add granular clinical access rules based on appointment assignment or explicit patient authorization.
- Add a formal content-management interface with versioning and publishing controls for website content.
- Add eyewear product administration, inventory integration, cart, and ordering workflows for the eyewear catalog.
- Add multi-branch support with branch-specific settings, staff assignments, and reporting.
- Add automated unit, integration, API-security, and end-to-end tests.
- Add structured request validation and centralized error handling for all API endpoints.
- Add observability, alerting, backup automation, disaster-recovery procedures, and performance monitoring.
- Implement automatic invoice reminders on a configurable schedule.
- Add support for multiple currencies and localization for international clinic operations.
- Implement recurring invoices for subscription services.
- Add customer/patient credit accounts and prepayment tracking.
- Add financial reconciliation and settlement procedures.

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

HM VisionSync currently provides a functional foundation for Hernandez Mercado Eye Clinic's public web presence and authenticated clinic workflows. Its strongest implemented areas are account access, role-restricted dashboards, appointment handling, follow-up management, clinical-record storage, owner administration, clinic settings, billing and invoicing, payment management, supplier and inventory tracking, comprehensive audit visibility, and email OTP password recovery.

The system is a working clinic management suite with end-to-end appointment and billing workflows. Advanced reporting, persistent notifications, administrative content management, granular clinical authorization, automated testing, production secret rotation, and operational monitoring remain as potential enhancements. With those additions, HM VisionSync can evolve into a more comprehensive enterprise clinic platform while maintaining the current Astro, Express, and MongoDB architecture.

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
| Prescription management | Implemented | Prescriptions are represented as `ClinicalRecord` type with full lifecycle support. |
| Eye examination workflow | Partially Implemented | Consultation and clinical-record forms exist; no specialized examination schema or structured findings model. |
| Clinic queue | Planned / Referenced | Frontend navigation and placeholder copy exist; no queue model or API was found. |
| Patient check-in | Planned / Referenced | Frontend route label exists; no dedicated implementation was found. |
| Billing / Invoicing | Implemented | Complete invoicing system with templates, itemization, status tracking, and audit logging. |
| Payments / Transactions | Implemented | Payment recording, reversal, balance tracking, and transaction history are fully implemented. |
| Invoice Templates | Implemented | Customizable template builder with element positioning, dynamic fields, and default templates. |
| Suppliers | Implemented | Supplier creation and management with contact information tracking. |
| Purchase Orders | Implemented | Purchase order creation linked to suppliers with itemized products. |
| Inventory Items | Implemented | Inventory item creation with SKU tracking and quantity management. |
| Inventory Movements | Implemented | Stock-in, stock-out, receiving, and stock-adjustment operations with auto-calculated quantities. |
| Payment Reminders | Implemented | Email reminders for unpaid invoices using Resend. |
| Billing Summary | Implemented | Dashboard showing total invoiced, collected, outstanding, and overdue amounts. |
| Notifications | Partially Implemented | Client-side derived appointment/follow-up notices exist; no persistent notification model/API. |
| Appointment email notifications | Partially Implemented | Optional SMTP mailer exists; skipped when SMTP is not configured. |
| Website content management | Partially Implemented | Static content configuration and public read endpoint exist; no admin editing/publishing workflow. |
| User management | Implemented | Owner can create managed roles and activate/deactivate non-owner accounts. |
| Roles and permissions | Partially Implemented | Backend role enforcement exists; Owner page returns a static permission summary, not editable permissions. |
| Audit logs | Implemented | Comprehensive logging covers appointments, clinic settings, invoicing, payments, inventory, and supplier operations. |
| Reports and analytics | Planned / Referenced | Owner Reports route exists, but no report API, aggregation, charts, or exports were found. |
| Clinic settings | Implemented | Owner can read/update singleton clinic settings; updates create audit entries. |
| Local MongoDB | Implemented | Development fallback and explicit local URI are supported. |
| MongoDB Atlas | Implemented | `mongodb+srv://...` connection configuration is supported for hosted environments. |
| Vercel frontend deployment | Implemented | Vercel config targets Astro static output in `frontend/dist`. |
| Render backend deployment | Implemented | Render service config includes Node build/start commands and health check. |
| Automated tests | Not Found | No test suite or test files were found in the scanned project. |
