import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Product } from '../../types';

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Product, 'id'>) => Promise<void>;
  product?: Product; // If editing existing product
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  product
}) => {
  const [formData, setFormData] = useState({
    name: '',
    category: 'buns' as 'buns' | 'bread' | 'snacks',
    currentInventory: 0,
    lastOrderQuantity: 0
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        category: product.category,
        currentInventory: product.currentInventory,
        lastOrderQuantity: product.lastOrderQuantity
      });
    } else {
      setFormData({
        name: '',
        category: 'buns',
        currentInventory: 0,
        lastOrderQuantity: 0
      });
    }
    setErrors({});
  }, [product, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Product name is required';
    }

    if (formData.currentInventory < 0) {
      newErrors.currentInventory = 'Inventory must be 0 or greater';
    }

    if (formData.lastOrderQuantity < 0) {
      newErrors.lastOrderQuantity = 'Last order quantity must be 0 or greater';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Error submitting product:', error);
      setErrors({ submit: 'Failed to save product. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? 'Edit Product' : 'Add New Product'}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Product Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., Hamburger Buns"
          />
          {errors.name && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.name}</p>
          )}
        </div>

        {/* Category */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Category *
          </label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value as 'buns' | 'bread' | 'snacks' })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
          >
            <option value="buns">Buns</option>
            <option value="bread">Bread</option>
            <option value="snacks">Snacks</option>
          </select>
        </div>

        {/* Current Inventory */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Current Inventory
          </label>
          <input
            type="number"
            value={formData.currentInventory}
            onChange={(e) => setFormData({ ...formData, currentInventory: parseInt(e.target.value) || 0 })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            min="0"
          />
          {errors.currentInventory && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.currentInventory}</p>
          )}
        </div>

        {/* Last Order Quantity */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Last Order Quantity
          </label>
          <input
            type="number"
            value={formData.lastOrderQuantity}
            onChange={(e) => setFormData({ ...formData, lastOrderQuantity: parseInt(e.target.value) || 0 })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            min="0"
          />
          {errors.lastOrderQuantity && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.lastOrderQuantity}</p>
          )}
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-4 bg-red-50 border-2 border-red-200 rounded-2xl">
            <p className="text-red-600 text-sm font-bold">{errors.submit}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-4 bg-gray-50 text-black font-black uppercase tracking-widest text-xs rounded-2xl border border-gray-200 hover:bg-gray-100 transition-all active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-xs rounded-2xl transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-save"></i>
                {product ? 'Update Product' : 'Add Product'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
