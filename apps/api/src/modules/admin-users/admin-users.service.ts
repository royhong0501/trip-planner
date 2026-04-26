import { Injectable } from '@nestjs/common';
import type { AdminUser } from '@trip-planner/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { HttpError } from '../../common/exceptions/http.exception.js';

type AdminUserRecord = {
  id: string;
  email: string;
  createdAt: Date;
};

function toDto(row: AdminUserRecord): AdminUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async list(): Promise<AdminUser[]> {
    const rows = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(email: string, password: string): Promise<AdminUser> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) throw HttpError.conflict('此 Email 已被使用');

    const passwordHash = await this.authService.hashPassword(password);
    const row = await this.prisma.adminUser.create({
      data: { email: normalized, passwordHash },
    });
    return toDto(row);
  }

  async updatePassword(userId: string, password: string): Promise<AdminUser> {
    const passwordHash = await this.authService.hashPassword(password);
    try {
      const row = await this.prisma.adminUser.update({
        where: { id: userId },
        data: { passwordHash, updatedAt: new Date() },
      });
      return toDto(row);
    } catch (err) {
      if (isNotFound(err)) throw HttpError.notFound('使用者不存在');
      throw err;
    }
  }

  async delete(userId: string, requesterSub: string): Promise<void> {
    if (requesterSub === userId) {
      throw HttpError.badRequest('無法刪除自己的帳號');
    }
    try {
      await this.prisma.adminUser.delete({ where: { id: userId }, select: { id: true } });
    } catch (err) {
      if (isNotFound(err)) throw HttpError.notFound('使用者不存在');
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
