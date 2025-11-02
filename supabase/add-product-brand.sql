-- Add product_brand column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_brand TEXT;

