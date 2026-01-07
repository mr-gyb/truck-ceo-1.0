import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { INITIAL_PRODUCTS, INITIAL_EMPLOYEES, INITIAL_FLEET, SALE_ALERTS, ROUTES } from '../constants';

export async function migrateInitialData(businessId: string) {
  console.log('🚀 Starting data migration for business:', businessId);

  try {
    // Migrate Products
    console.log('📦 Migrating products...');
    for (const product of INITIAL_PRODUCTS) {
      await setDoc(doc(db, `businesses/${businessId}/products`, product.id), {
        name: product.name,
        category: product.category,
        currentInventory: product.currentInventory,
        lastOrderQuantity: product.lastOrderQuantity
      });
    }
    console.log(`✅ Migrated ${INITIAL_PRODUCTS.length} products`);

    // Migrate Employees (with empty assignedRoutes initially)
    console.log('👥 Migrating employees...');
    for (const employee of INITIAL_EMPLOYEES) {
      await setDoc(doc(db, `businesses/${businessId}/employees`, employee.id), {
        userId: null, // No auth account initially
        name: employee.name,
        role: employee.role,
        email: null,
        assignedRoutes: [], // Empty initially, business owner can assign later
        hoursThisWeek: employee.hoursThisWeek,
        engagementScore: employee.engagementScore,
        status: employee.status,
        salesHistory: employee.salesHistory,
        attendance: employee.attendance,
        vacationDaysUsed: employee.vacationDaysUsed,
        sickDaysUsed: employee.sickDaysUsed
      });
    }
    console.log(`✅ Migrated ${INITIAL_EMPLOYEES.length} employees`);

    // Migrate Fleet
    console.log('🚛 Migrating fleet...');
    for (const truck of INITIAL_FLEET) {
      await setDoc(doc(db, `businesses/${businessId}/trucks`, truck.id), {
        plate: truck.plate,
        type: truck.type,
        mileage: truck.mileage,
        lastService: truck.lastService,
        healthStatus: truck.healthStatus,
        issues: truck.issues,
        maintenanceHistory: truck.maintenanceHistory,
        registrationExpiry: truck.registrationExpiry,
        insuranceExpiry: truck.insuranceExpiry,
        dimensions: truck.dimensions,
        upkeep: truck.upkeep
      });
    }
    console.log(`✅ Migrated ${INITIAL_FLEET.length} trucks`);

    // Migrate Routes
    console.log('🗺️  Migrating routes...');
    for (const route of ROUTES) {
      await setDoc(doc(db, `businesses/${businessId}/routes`, route.id), {
        name: route.name,
        stores: route.stores,
        assignedDriverId: null // Can be assigned later
      });
    }
    console.log(`✅ Migrated ${ROUTES.length} routes`);

    // Migrate Sale Alerts
    console.log('🔔 Migrating sale alerts...');
    for (const alert of SALE_ALERTS) {
      await setDoc(doc(db, `businesses/${businessId}/saleAlerts`, alert.id), {
        storeName: alert.storeName,
        promoType: alert.promoType,
        date: alert.date,
        contactName: alert.contactName
      });
    }
    console.log(`✅ Migrated ${SALE_ALERTS.length} sale alerts`);

    console.log('🎉 Migration complete!');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}
