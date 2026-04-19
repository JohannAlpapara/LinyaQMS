# LinyaQMS

A comprehensive, production-ready queueing system for multi-lane service environments. Built with Next.js 16.2.1, TypeScript, Tailwind CSS, shadcn/ui, and MySQL (Prisma ORM).

---

## Features

### User Roles
- **Admin**: Full dashboard access, manage users and lanes
- **User (Cashier/Staff)**: Queue operations for assigned lanes (Next, Call, Buzz, Serve)
- **Display**: Real-time display of all active lanes and queue status
- **Reservation**: Customer-facing interface to get queue numbers and wait times

### Core Functions
- **Admin Dashboard**: Manage lanes, users, assignments, and view live stats
- **Queue Operations**: Advance, call, buzz, and serve queue numbers (per lane, per day, with daily reset)
- **Reservation System**: Customers select a lane, get a queue number, and see estimated wait
- **Display System**: Shows all active lanes, current/next numbers, and queue status in real time
- **Role-based Authentication**: Custom, secure, no third-party providers
- **Daily Reset**: Queue numbers and stats are always based on today’s operations only
- **Responsive UI**: Built with shadcn/ui and Tailwind CSS for a modern, accessible experience
- **Physical Ticket Printing**: Print queue tickets for customers (if printer is connected)
- **Real-Time Updates**: All interfaces update automatically for live queue status

### Tech Stack
- **Frontend**: Next.js 16.2.1 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes, Prisma ORM
- **Database**: MySQL
- **Authentication**: Custom JWT-based

---

## Getting Started

### Prerequisites
- Node.js 18+
- Docker (recommended)
- Optional: MySQL if not using Docker

### Installation
```bash
git clone <repo-url>
cd linyaqms
npm install
```

### .env setup
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Update values in `.env`:
   - `DATABASE_URL` (MySQL connection string)
   - `JWT_SECRET` (strong random secret)
   - `NODE_ENV=development`
   - `PORT=3000`

### Docker local database (recommended)
```bash
# remove existing container if present
docker rm -f linyaqms-db 2>/dev/null || true

# start MySQL 8 with a stable unique port
docker run -d --name linyaqms-db \
  -e MYSQL_ROOT_PASSWORD=secret \
  -e MYSQL_DATABASE=linyaqms_dev \
  -e MYSQL_USER=linya \
  -e MYSQL_PASSWORD=secret \
  -p 3307:3306 \
  mysql:8.0
```

Wait 10-20s, then verify:
```bash
docker logs --tail 20 linyaqms-db
```

Update your `.env` if needed:
```bash
DATABASE_URL="mysql://linya:secret@127.0.0.1:3307/linyaqms_dev"
```

### Prisma database setup
```bash
npm run db:generate
npm run db:push
npm run db:seed
```

### Run locally
```bash
npm run dev
```

- Default URL: `http://localhost:3000` (or next available port if occupied)

### Run production locally
1. Build the app:
   ```bash
   npm run build
   ```
2. Start in production mode:
   ```bash
   npm run start
   ```
3. App runs at `http://localhost:3000` (or `PORT` value)

### Production Build
```bash
npm run build
npm run build:production
```

---

## Demo Users (Default Seed)
- **Admin**: admin / admin123
- **Cashier 1**: c1 / 123
- **Cashier 2**: c2 / 123

## Demo Lanes (Default Seed)
- **Regular Lane**: General queue for all customers
- **PWD Lane**: Priority for PWDs and Senior Citizens

---

## Project Structure
```
src/
  app/
    admin/         # Admin dashboard
    user/          # Cashier interface
    display/       # Display screens
    reservation/   # Customer reservation
    api/           # API routes
  components/
    ui/            # shadcn/ui components
  lib/             # Auth, Prisma, utils
prisma/            # Prisma schema & migrations
public/            # Static assets
scripts/           # Seed and utility scripts
```

---

## Key API Endpoints
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/lanes` — List all lanes (today's stats)
- `GET /api/queue/reservation` — Lane status for reservation (today only)
- `POST /api/queue/reservation` — Get a new queue number
- `POST /api/queue/operations` — Queue actions (Next, Call, Buzz, Serve)
- `GET /api/users/assigned-lanes` — Lanes assigned to current user (today only)

---

## Development Scripts
- `npm run dev` — Start dev server
- `npm run build` — Build for production
- `npm run build:production` — Create deployable package
- `npm run db:generate` — Generate Prisma client
- `npm run db:push` — Push schema to DB
- `npm run db:seed` — Seed DB with demo data

---

## Database Entities
- **User**: System users (admin, cashier, etc.)
- **Lane**: Service lanes (regular, PWD, etc.)
- **LaneUser**: Assignment of users to lanes
- **QueueItem**: Queue entries (per lane, per day)

---

## Production Deployment
1. Run `npm run build:production` (see `production/` folder)
2. Copy `production/` to your server
3. On the server, install dependencies and set production environment variables:
   - `npm install --production`
   - `NODE_ENV=production`
   - `PORT=3000` (or pick a different port)
4. Start the app in production mode:
   - `npm run start`
   - or with PM2: `npm run start:silent`

---

## License
MIT

---

For questions or support, open an issue in this repository.
