export interface IAdminRoleChecker {
  isAdminOrEmployee(userId: string): Promise<boolean>;
  isAdmin(userId: string): Promise<boolean>;
}
