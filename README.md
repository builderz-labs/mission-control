# Mission Control - ClawdBot Agent Orchestration UI

A modern, real-time dashboard for monitoring and managing ClawdBot agent networks.

![Mission Control Dashboard](https://img.shields.io/badge/status-alpha-orange.svg)
![Next.js](https://img.shields.io/badge/Next.js-14+-black.svg?logo=next.js)
![React](https://img.shields.io/badge/React-19+-blue.svg?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg?logo=typescript)

## Features

### 🚀 Real-time Monitoring
- Live WebSocket connection to ClawdBot Gateway (ws://127.0.0.1:18789)
- Real-time session tracking and status updates
- Connection state management with auto-reconnection

### 📊 Comprehensive Dashboard
- **Overview Panel**: System stats, uptime, active sessions, message counts
- **Sessions List**: Detailed view of all active and idle sessions
- **Agent Network**: Visual graph representation of agent relationships
- **Connection HUD**: Real-time connection status and controls

### 🎨 Modern UI/UX
- Dark theme matching ClawdBot aesthetic
- Responsive design (mobile-friendly)
- Built with Tailwind CSS and shadcn/ui components
- Clean, professional interface

### 🕸️ Network Visualization
- Interactive agent relationship graphs using React Flow
- Visual representation of main agents, subagents, and cron jobs
- Animated connections showing active data flow

## Tech Stack

- **Frontend**: Next.js 14+ with App Router
- **UI Framework**: React 19 with TypeScript
- **Styling**: Tailwind CSS + Custom CSS Variables
- **Components**: Radix UI primitives (shadcn/ui)
- **Visualization**: React Flow for network graphs
- **State Management**: Zustand (lightweight)
- **Real-time**: WebSocket integration
- **Development**: ESLint, TypeScript strict mode

## Quick Start

### Prerequisites
- Node.js 18+ or Bun
- ClawdBot Gateway running on `ws://127.0.0.1:18789`

### Installation

```bash
cd /home/ubuntu/repos/mission-control

# Install dependencies
npm install

# Start development server
npm run dev

# Or using bun
bun install
bun dev
```

The dashboard will be available at `http://localhost:3000`

### Build for Production

```bash
# Build the application
npm run build

# Start production server
npm start
```

## Project Structure

```
src/
├── app/                 # Next.js App Router
│   ├── layout.tsx      # Root layout with dark theme
│   ├── page.tsx        # Main dashboard page
│   └── globals.css     # Global styles + Tailwind
├── components/
│   ├── dashboard/      # Core dashboard components
│   │   ├── dashboard.tsx
│   │   ├── sidebar.tsx
│   │   ├── stats-grid.tsx
│   │   ├── sessions-list.tsx
│   │   └── agent-network.tsx
│   ├── hud/           # HUD/overlay components
│   │   └── connection-status.tsx
│   └── ui/            # shadcn/ui components (to be added)
├── lib/
│   ├── websocket.ts   # WebSocket hook and utilities
│   └── utils.ts       # Helper functions and utilities
├── stores/
│   └── app-store.ts   # Zustand state management
└── types/
    └── index.ts       # TypeScript type definitions
```

## WebSocket Integration

The dashboard connects to the ClawdBot Gateway via WebSocket:

- **Endpoint**: `ws://127.0.0.1:18789`
- **Auto-reconnection**: Exponential backoff (max 5 attempts)
- **Message handling**: JSON parsing with fallback for raw messages
- **Connection state**: Real-time status indicators

### Message Types

```typescript
interface WebSocketMessage {
  type: string
  data: any
  timestamp?: number
}
```

## Features Roadmap

### Phase 2 (Coming Soon)
- [ ] Agent control interface (start/stop/restart)
- [ ] Log streaming and filtering
- [ ] Performance metrics and charts
- [ ] Session history and analytics
- [ ] Agent configuration management

### Phase 3 (Future)
- [ ] Multi-gateway support
- [ ] Alert system for errors/issues
- [ ] Agent deployment interface
- [ ] Custom dashboard layouts
- [ ] Export/reporting features

## Development

### Adding Components

To add shadcn/ui components:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
```

### Environment Variables

Create a `.env.local` file for local development:

```env
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789
NEXT_PUBLIC_APP_NAME=Mission Control
```

### Debugging

The dashboard includes a debug panel that shows raw WebSocket messages:
- Open browser dev tools
- Check the "Last WebSocket Message" collapsible section
- Monitor real-time message flow

## Architecture

### Data Flow
1. **WebSocket Connection**: Establishes real-time link to ClawdBot Gateway
2. **Message Processing**: Parses session data, agent status, and system metrics
3. **State Updates**: Updates React state to trigger UI re-renders
4. **Visualization**: Renders dashboard components with live data

### Key Files
- `src/lib/websocket.ts`: Core WebSocket functionality
- `src/app/page.tsx`: Main dashboard orchestration
- `src/components/dashboard/dashboard.tsx`: Central data coordinator
- `src/types/index.ts`: Type definitions for all data structures

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**Built for ClawdBot v2.0+**  
Part of the ClawdBot ecosystem for advanced AI agent orchestration.