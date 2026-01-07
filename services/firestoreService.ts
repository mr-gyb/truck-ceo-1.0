import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { Product, Employee, Truck, SaleAlert, RouteTerritory } from '../types';

export class FirestoreService {
  constructor(private businessId: string) {}

  // ===== PRODUCTS =====
  async getProducts(): Promise<Product[]> {
    const snapshot = await getDocs(collection(db, `businesses/${this.businessId}/products`));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
  }

  async getProduct(productId: string): Promise<Product | null> {
    const docSnap = await getDoc(doc(db, `businesses/${this.businessId}/products`, productId));
    return docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as Product) : null;
  }

  async updateProduct(productId: string, data: Partial<Omit<Product, 'id'>>): Promise<void> {
    await updateDoc(doc(db, `businesses/${this.businessId}/products`, productId), data);
  }

  async addProduct(product: Omit<Product, 'id'>): Promise<string> {
    const docRef = doc(collection(db, `businesses/${this.businessId}/products`));
    await setDoc(docRef, product);
    return docRef.id;
  }

  async deleteProduct(productId: string): Promise<void> {
    await deleteDoc(doc(db, `businesses/${this.businessId}/products`, productId));
  }

  // ===== EMPLOYEES =====
  async getEmployees(): Promise<Employee[]> {
    const snapshot = await getDocs(collection(db, `businesses/${this.businessId}/employees`));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
  }

  async getEmployee(employeeId: string): Promise<Employee | null> {
    const docSnap = await getDoc(doc(db, `businesses/${this.businessId}/employees`, employeeId));
    return docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as Employee) : null;
  }

  async updateEmployee(employeeId: string, data: Partial<Omit<Employee, 'id'>>): Promise<void> {
    await updateDoc(doc(db, `businesses/${this.businessId}/employees`, employeeId), data);
  }

  async addEmployee(employee: Omit<Employee, 'id'> & { userId?: string | null; email?: string | null; assignedRoutes?: string[] }): Promise<string> {
    const docRef = doc(collection(db, `businesses/${this.businessId}/employees`));
    await setDoc(docRef, {
      ...employee,
      userId: employee.userId || null,
      email: employee.email || null,
      assignedRoutes: employee.assignedRoutes || []
    });
    return docRef.id;
  }

  async deleteEmployee(employeeId: string): Promise<void> {
    await deleteDoc(doc(db, `businesses/${this.businessId}/employees`, employeeId));
  }

  // ===== ROUTES =====
  async getRoutes(): Promise<RouteTerritory[]> {
    const snapshot = await getDocs(collection(db, `businesses/${this.businessId}/routes`));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RouteTerritory));
  }

  async getRoute(routeId: string): Promise<RouteTerritory | null> {
    const docSnap = await getDoc(doc(db, `businesses/${this.businessId}/routes`, routeId));
    return docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as RouteTerritory) : null;
  }

  async getRoutesForTeamMember(assignedRouteIds: string[]): Promise<RouteTerritory[]> {
    if (assignedRouteIds.length === 0) return [];

    const allRoutes = await this.getRoutes();
    return allRoutes.filter(route => assignedRouteIds.includes(route.id));
  }

  async updateRoute(routeId: string, data: Partial<Omit<RouteTerritory, 'id'>>): Promise<void> {
    await updateDoc(doc(db, `businesses/${this.businessId}/routes`, routeId), data);
  }

  async addRoute(route: Omit<RouteTerritory, 'id'>): Promise<string> {
    const docRef = doc(collection(db, `businesses/${this.businessId}/routes`));
    await setDoc(docRef, route);
    return docRef.id;
  }

  async deleteRoute(routeId: string): Promise<void> {
    await deleteDoc(doc(db, `businesses/${this.businessId}/routes`, routeId));
  }

  // ===== TRUCKS =====
  async getTrucks(): Promise<Truck[]> {
    const snapshot = await getDocs(collection(db, `businesses/${this.businessId}/trucks`));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Truck));
  }

  async getTruck(truckId: string): Promise<Truck | null> {
    const docSnap = await getDoc(doc(db, `businesses/${this.businessId}/trucks`, truckId));
    return docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as Truck) : null;
  }

  async updateTruck(truckId: string, data: Partial<Omit<Truck, 'id'>>): Promise<void> {
    await updateDoc(doc(db, `businesses/${this.businessId}/trucks`, truckId), data);
  }

  async addTruck(truck: Omit<Truck, 'id'>): Promise<string> {
    const docRef = doc(collection(db, `businesses/${this.businessId}/trucks`));
    await setDoc(docRef, truck);
    return docRef.id;
  }

  async deleteTruck(truckId: string): Promise<void> {
    await deleteDoc(doc(db, `businesses/${this.businessId}/trucks`, truckId));
  }

  // ===== SALE ALERTS =====
  async getSaleAlerts(): Promise<SaleAlert[]> {
    const snapshot = await getDocs(collection(db, `businesses/${this.businessId}/saleAlerts`));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleAlert));
  }

  async getSaleAlert(alertId: string): Promise<SaleAlert | null> {
    const docSnap = await getDoc(doc(db, `businesses/${this.businessId}/saleAlerts`, alertId));
    return docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as SaleAlert) : null;
  }

  async updateSaleAlert(alertId: string, data: Partial<Omit<SaleAlert, 'id'>>): Promise<void> {
    await updateDoc(doc(db, `businesses/${this.businessId}/saleAlerts`, alertId), data);
  }

  async addSaleAlert(alert: Omit<SaleAlert, 'id'>): Promise<string> {
    const docRef = doc(collection(db, `businesses/${this.businessId}/saleAlerts`));
    await setDoc(docRef, alert);
    return docRef.id;
  }

  async deleteSaleAlert(alertId: string): Promise<void> {
    await deleteDoc(doc(db, `businesses/${this.businessId}/saleAlerts`, alertId));
  }
}
