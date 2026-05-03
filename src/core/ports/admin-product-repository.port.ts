import type {
  ListProductsDto, ListProductsResult,
  GetProductDto, GetProductResult,
  CreateProductDto, CreateProductResult,
  UpdateProductDto, UpdateProductResult,
  DeleteProductDto, DeleteProductResult,
  ToggleProductActiveDto, ToggleProductActiveResult,
  CreateVariantDto, CreateVariantResult,
  UpdateVariantDto, UpdateVariantResult,
  DeleteVariantDto, DeleteVariantResult,
  ToggleVariantActiveDto, ToggleVariantActiveResult,
  ListMetadataResult,
  ListFeaturedResult,
  UpdateFeaturedFlagsDto, UpdateFeaturedFlagsResult,
  ListProductVariantsDto, ListProductVariantsResult,
} from '../use-cases/products/product.types.js';

export interface IAdminProductRepository {
  listProducts(dto: ListProductsDto): Promise<ListProductsResult>;
  getProduct(dto: GetProductDto): Promise<GetProductResult>;
  createProduct(dto: CreateProductDto): Promise<CreateProductResult>;
  updateProduct(dto: UpdateProductDto): Promise<UpdateProductResult>;
  deleteProduct(dto: DeleteProductDto): Promise<DeleteProductResult>;
  toggleProductActive(dto: ToggleProductActiveDto): Promise<ToggleProductActiveResult>;
  listProductVariants(dto: ListProductVariantsDto): Promise<ListProductVariantsResult>;
  createVariant(dto: CreateVariantDto): Promise<CreateVariantResult>;
  updateVariant(dto: UpdateVariantDto): Promise<UpdateVariantResult>;
  deleteVariant(dto: DeleteVariantDto): Promise<DeleteVariantResult>;
  toggleVariantActive(dto: ToggleVariantActiveDto): Promise<ToggleVariantActiveResult>;
  listMetadata(): Promise<ListMetadataResult>;
  listFeatured(): Promise<ListFeaturedResult>;
  updateFeaturedFlags(dto: UpdateFeaturedFlagsDto): Promise<UpdateFeaturedFlagsResult>;
}
