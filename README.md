# 🚚 TruckCEO

Modern fleet management and business operations platform for truck-based businesses.

**Live Site:** https://truckceo.com

## ✨ Features

### Full CRUD Operations
- **Products Management** - Smart ordering system with inventory tracking
- **Team Management** - Employee onboarding, engagement tracking, route assignments
- **Fleet Management** - Truck registration, maintenance logs, health monitoring
- **Routes & Stores** - Territory and location management
- **Promo Alerts** - Sale and promotion request system

### Core Capabilities
- 🔐 Firebase Authentication (Business Owner & Team Member roles)
- 📊 Real-time data with Firestore
- 📈 Revenue analytics and insights
- 🌤️ Weather integration for demand forecasting
- 🗺️ Smart navigation system
- 📤 CSV data import
- 🔔 Toast notifications
- ♿ Accessibility support (ARIA, keyboard navigation, focus management)
- 📱 Responsive mobile design

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript
- **Build Tool**: Vite
- **Backend**: Firebase (Auth, Firestore, Storage)
- **Charts**: Recharts
- **Styling**: Tailwind CSS utility classes
- **Deployment**: Firebase Hosting

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/truckceo.git
cd truckceo

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🚀 Deployment

### Firebase Hosting

```bash
# Login to Firebase
firebase login

# Deploy to hosting
firebase deploy --only hosting
```

The app is configured to deploy to **https://truckceo.com**

## 📁 Project Structure

```
truckceo/
├── components/             # React components
│   ├── forms/             # Form modals (Product, Employee, Truck, Route, Store, Alert)
│   ├── Modal.tsx          # Accessible modal with focus trap
│   ├── ConfirmDialog.tsx  # Delete confirmation dialogs
│   ├── ToastContainer.tsx # Toast notifications
│   └── LoadingSkeleton.tsx # Loading states
├── contexts/              # React contexts
│   ├── AuthContext.tsx    # Authentication & user management
│   └── DataContext.tsx    # Data fetching & CRUD operations
├── hooks/                 # Custom React hooks
│   └── useToast.ts        # Toast notification system
├── services/              # Firebase services
│   ├── firebaseConfig.ts  # Firebase initialization
│   └── firestoreService.ts # Firestore CRUD operations
├── types.ts               # TypeScript type definitions
├── constants.ts           # App constants
└── App.tsx                # Main app component
```

## 🎨 Design System

### Colors
- **Primary**: `#FFD700` (Gold)
- **Secondary**: `#000000` (Black)
- **Background**: `#FFFFFF` (White)
- **Danger**: `#DC2626` (Red)

### Border Radius
- Large cards: `2.5rem`
- Medium: `2rem`
- Buttons: `1.5rem`

### Typography
- Font weights: Black (900), Bold (700)
- Text transform: Uppercase with letter-spacing

## 🔐 Security & Permissions

### Role-Based Access Control
- **Business Owners**: Full CRUD access to all data
- **Team Members**: Read-only access (can edit own profile only)

### Firebase Security
- Firestore Security Rules enforce role-based permissions
- Authentication required for all app access
- Client-side API keys are safe (protected by Firebase Security Rules)

## 🧪 Testing

The app includes comprehensive CRUD functionality:

1. **Products** - Add/Edit/Delete products with form validation
2. **Employees** - Full team management with route assignments
3. **Trucks** - Fleet registration and maintenance tracking
4. **Routes & Stores** - Hierarchical territory management
5. **Sale Alerts** - Promo request system with store selection

All operations include:
- Toast notifications
- Confirmation dialogs for deletes
- Form validation
- Loading states
- Error handling

## 📄 License

Private - All Rights Reserved

## 👨‍💻 Author

TruckCEO Team
