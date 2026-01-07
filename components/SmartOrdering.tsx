
import React, { useState, useEffect } from 'react';
import { Product, SmartSuggestion, Store, RouteTerritory } from '../types';
import { getSmartOrderSuggestions } from '../services/geminiService';
import { RouteSwitcher } from './RouteSwitcher';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { ProductFormModal } from './forms/ProductFormModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ProtectedFeature } from './ProtectedFeature';

interface SmartOrderingProps {
  products: Product[];
  currentStore: Store | null;
  currentRoute: RouteTerritory | null;
  onRouteChange: (r: RouteTerritory | null) => void;
  onStoreChange: (s: Store | null) => void;
}

export const SmartOrdering: React.FC<SmartOrderingProps> = ({
  products,
  currentStore,
  currentRoute,
  onRouteChange,
  onStoreChange
}) => {
  const { addProduct, updateProduct, deleteProduct } = useData();
  const { userProfile } = useAuth();
  const { toasts, showToast, removeToast } = useToast();

  const [suggestions, setSuggestions] = useState<SmartSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // Modal state
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    // Passing currentStore context to AI would be better but keeping simple for demo
    const data = await getSmartOrderSuggestions(products, date);
    setSuggestions(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchSuggestions();
  }, [date, currentStore, currentRoute]);

  // Handle add product
  const handleAddProduct = () => {
    setEditingProduct(undefined);
    setShowProductModal(true);
  };

  // Handle edit product
  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setShowProductModal(true);
  };

  // Handle delete product
  const handleDeleteClick = (product: Product) => {
    setDeletingProduct(product);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) return;

    try {
      await deleteProduct(deletingProduct.id);
      showToast(`${deletingProduct.name} deleted successfully`, 'success');
      setDeletingProduct(null);
    } catch (error) {
      console.error('Error deleting product:', error);
      showToast('Failed to delete product', 'error');
    }
  };

  // Handle product form submit
  const handleProductSubmit = async (data: Omit<Product, 'id'>) => {
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
        showToast('Product updated successfully', 'success');
      } else {
        await addProduct(data);
        showToast('Product added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving product:', error);
      showToast('Failed to save product', 'error');
      throw error; // Re-throw to let modal handle it
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Route Switcher Integrated at Top */}
      <RouteSwitcher
        currentRoute={currentRoute}
        currentStore={currentStore}
        onRouteChange={onRouteChange}
        onStoreChange={onStoreChange}
      />

      <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-black text-black mb-1 flex items-center gap-3 uppercase tracking-tighter">
              <i className="fas fa-wand-magic-sparkles text-[#FFD700]"></i>
              Order Planner
            </h2>
          </div>
          <ProtectedFeature requiredRole="business_owner">
            <button
              onClick={handleAddProduct}
              className="px-6 py-3 bg-black text-[#FFD700] font-black uppercase tracking-widest text-[10px] rounded-xl transition-all shadow-xl active:scale-95 hover:bg-gray-900 flex items-center gap-2"
            >
              <i className="fas fa-plus"></i>
              Add Product
            </button>
          </ProtectedFeature>
        </div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 border-b border-gray-50 pb-2">
          Focus: {currentStore ? currentStore.name : currentRoute ? currentRoute.name : 'Global Route View'}
        </p>
        
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em]">Simulation Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)}
            className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-[#FFD700] outline-none font-black text-black"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center px-4">
          <h3 className="font-black text-[10px] uppercase tracking-[0.25em] text-gray-400">Inventory Forecast</h3>
          {loading && <i className="fas fa-spinner fa-spin text-[#FFD700]"></i>}
        </div>

        {suggestions.map((suggestion) => {
          const product = products.find(p => p.id === suggestion.productId);
          if (!product) return null;

          return (
            <div key={suggestion.productId} className="bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100 relative overflow-hidden group hover:border-black transition-all">
              {suggestion.impactLevel === 'high' && (
                <div className="absolute top-0 right-0 bg-black text-[#FFD700] text-[9px] px-5 py-2 font-black uppercase tracking-widest rounded-bl-3xl">
                  Peak Trend
                </div>
              )}

              {/* Edit/Delete buttons (business owner only) */}
              <ProtectedFeature requiredRole="business_owner">
                <div className="absolute top-6 left-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEditProduct(product)}
                    className="w-8 h-8 bg-black text-[#FFD700] rounded-lg flex items-center justify-center hover:bg-gray-900 transition-all active:scale-95 shadow-lg"
                  >
                    <i className="fas fa-edit text-xs"></i>
                  </button>
                  <button
                    onClick={() => handleDeleteClick(product)}
                    className="w-8 h-8 bg-red-600 text-white rounded-lg flex items-center justify-center hover:bg-red-700 transition-all active:scale-95 shadow-lg"
                  >
                    <i className="fas fa-trash text-xs"></i>
                  </button>
                </div>
              </ProtectedFeature>

              <div className="flex justify-between items-start mb-5">
                <div>
                  <h4 className="font-black text-black text-lg leading-tight uppercase tracking-tight max-w-[150px]">{product.name}</h4>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">Available: {product.currentInventory}</p>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-black text-black leading-none group-hover:text-[#FFD700] transition-colors tracking-tighter">
                    {suggestion.recommendedQty}
                  </div>
                  <p className="text-[8px] font-black text-gray-300 uppercase tracking-[0.3em] mt-1">Recommended</p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-[1.5rem] p-5 flex gap-4 items-start mb-6">
                <i className="fas fa-circle-info text-[#FFD700] text-xs mt-1"></i>
                <p className="text-[11px] text-gray-600 font-bold leading-relaxed uppercase tracking-tight">
                  "{suggestion.reason}"
                </p>
              </div>

              <div className="flex gap-3">
                <button className="flex-1 py-4 bg-gray-50 hover:bg-gray-100 text-black font-black uppercase tracking-[0.2em] rounded-2xl text-[9px] transition-all border border-gray-100">
                  Manual
                </button>
                <button className="flex-[2] py-4 bg-black hover:bg-gray-900 text-[#FFD700] font-black uppercase tracking-[0.2em] rounded-2xl text-[9px] transition-all shadow-xl shadow-black/10">
                  Submit to Store
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Product Form Modal */}
      <ProductFormModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        onSubmit={handleProductSubmit}
        product={editingProduct}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Product"
        message={`Are you sure you want to delete "${deletingProduct?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger={true}
      />
    </div>
  );
};
