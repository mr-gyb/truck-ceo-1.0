import Papa from 'papaparse';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebaseConfig';
import { FirestoreService } from './firestoreService';
import { Product, RouteTerritory, Store } from '../types';

export type CSVType = 'products' | 'routes' | 'stores';

interface CSVUploadResult {
  success: boolean;
  message: string;
  recordsProcessed: number;
}

export class CSVService {
  constructor(
    private businessId: string,
    private firestoreService: FirestoreService
  ) {}

  async uploadCSV(file: File, type: CSVType): Promise<CSVUploadResult> {
    try {
      console.log(`Uploading ${type} CSV file:`, file.name);

      // Upload file to Firebase Storage
      const storageRef = ref(
        storage,
        `businesses/${this.businessId}/csv-uploads/${Date.now()}_${file.name}`
      );
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      console.log('File uploaded to storage:', downloadURL);

      // Parse CSV
      const parseResult = await this.parseCSV(file);
      console.log('CSV parsed:', parseResult.data.length, 'rows');

      // Process based on type
      let recordsProcessed = 0;
      switch (type) {
        case 'products':
          recordsProcessed = await this.processProducts(parseResult.data);
          break;
        case 'routes':
          recordsProcessed = await this.processRoutes(parseResult.data);
          break;
        case 'stores':
          recordsProcessed = await this.processStores(parseResult.data);
          break;
      }

      return {
        success: true,
        message: `Successfully imported ${recordsProcessed} ${type}`,
        recordsProcessed
      };
    } catch (error) {
      console.error('CSV upload error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to process CSV file',
        recordsProcessed: 0
      };
    }
  }

  private parseCSV(file: File): Promise<Papa.ParseResult<any>> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results),
        error: (error) => reject(error)
      });
    });
  }

  private async processProducts(data: any[]): Promise<number> {
    let count = 0;
    for (const row of data) {
      try {
        const product: Omit<Product, 'id'> = {
          name: row.name || row.product_name || row.Product || row['Product Name'],
          category: this.normalizeCategory(row.category || row.Category || row.type || 'snacks'),
          currentInventory: parseInt(row.inventory || row.current_inventory || row.Inventory || row['Current Inventory'] || '0'),
          lastOrderQuantity: parseInt(row.last_order || row.order_quantity || row['Last Order'] || row['Order Quantity'] || '0')
        };

        if (product.name) {
          await this.firestoreService.addProduct(product);
          count++;
        }
      } catch (error) {
        console.error('Error processing product row:', row, error);
      }
    }
    return count;
  }

  private async processRoutes(data: any[]): Promise<number> {
    let count = 0;
    for (const row of data) {
      try {
        const route: Omit<RouteTerritory, 'id'> = {
          name: row.route_name || row['Route Name'] || row.name || row.Name,
          stores: []
        };

        if (route.name) {
          await this.firestoreService.addRoute(route);
          count++;
        }
      } catch (error) {
        console.error('Error processing route row:', row, error);
      }
    }
    return count;
  }

  private async processStores(data: any[]): Promise<number> {
    let count = 0;
    const routeStoresMap: { [routeName: string]: Store[] } = {};

    // Group stores by route
    for (const row of data) {
      try {
        const routeName = row.route_name || row['Route Name'] || row.route;
        const storeName = row.store_name || row['Store Name'] || row.name;
        const address = row.address || row.Address || row.location || '';

        if (routeName && storeName) {
          if (!routeStoresMap[routeName]) {
            routeStoresMap[routeName] = [];
          }

          routeStoresMap[routeName].push({
            id: `store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: storeName,
            address: address
          });
        }
      } catch (error) {
        console.error('Error processing store row:', row, error);
      }
    }

    // Update routes with stores
    const routes = await this.firestoreService.getRoutes();
    for (const route of routes) {
      const routeStores = routeStoresMap[route.name];
      if (routeStores && routeStores.length > 0) {
        await this.firestoreService.updateRoute(route.id, {
          stores: [...route.stores, ...routeStores]
        });
        count += routeStores.length;
      }
    }

    return count;
  }

  private normalizeCategory(category: string): 'buns' | 'bread' | 'snacks' {
    const normalized = category.toLowerCase().trim();
    if (normalized.includes('bun')) return 'buns';
    if (normalized.includes('bread') || normalized.includes('loaf')) return 'bread';
    return 'snacks';
  }
}
