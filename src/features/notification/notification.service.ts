import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './enums/notification-type.enum';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { ServiceInquiry } from '../inquiry/entities/service-inquiry.entity';
import { InquiryStatus } from '../inquiry/enums/inquiry-status.enum';
import { User } from '../auth/entities/user.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';

const DEFAULT_LIMIT = 20;

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async listForUser(
    userId: number,
    query: ListNotificationsQueryDto,
  ): Promise<{ items: Record<string, unknown>[]; unreadCount: number }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId })
      .orderBy('notification.created_at', 'DESC')
      .take(limit);

    if (query.unreadOnly) {
      qb.andWhere('notification.read_at IS NULL');
    }

    if (query.since) {
      qb.andWhere('notification.created_at > :since', { since: new Date(query.since) });
    }

    const [rows, unreadCount] = await Promise.all([
      qb.getMany(),
      this.countUnread(userId),
    ]);

    return {
      items: rows.map((row) => this.toPayload(row)),
      unreadCount,
    };
  }

  async countUnread(userId: number): Promise<number> {
    return this.notificationRepository.count({
      where: { userId, readAt: IsNull() },
    });
  }

  async markAsRead(userId: number, notificationId: number): Promise<Record<string, unknown>> {
    const row = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (!row) {
      throw new NotFoundException('Notification not found');
    }

    if (!row.readAt) {
      row.readAt = new Date();
      await this.notificationRepository.save(row);
    }

    return this.toPayload(row);
  }

  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();

    return { updated: result.affected ?? 0 };
  }

  async notifyCustomerFieldChanges(
    inquiry: ServiceInquiry,
    changedFields: string[],
  ): Promise<Notification | null> {
    if (!changedFields.length) return null;
    if (!inquiry.userId) return null;

    const fieldLabels: Record<string, string> = {
      loa: 'LOA',
      dwt: 'DWT',
      grt: 'GRT',
      cargoQty: 'Quantity (MT)',
      cargoType: 'Cargo type',
      cargoName: 'Cargo name',
      port: 'Port of call',
    };

    const changedLabels = changedFields
      .map((f) => fieldLabels[f] ?? f)
      .join(', ');

    const row = this.notificationRepository.create({
      userId: inquiry.userId,
      inquiryId: inquiry.id,
      type: NotificationType.INQUIRY_FIELD_CHANGED,
      title: 'Inquiry details updated',
      body: `Your inquiry ${inquiry.code || `#${inquiry.id}`} has been updated. Changed fields: ${changedLabels}.`,
      metadata: {
        inquiryId: inquiry.id,
        serviceType: inquiry.serviceType?.name ?? null,
        serviceSlug: this.toServiceSlug(inquiry.serviceType?.name),
        changedFields,
      },
      readAt: null,
    });

    return this.notificationRepository.save(row);
  }

  async notifyInquiryQuotedIfNeeded(
    inquiry: ServiceInquiry,
    previousStatus: string,
  ): Promise<Notification | null> {
    if (inquiry.status !== InquiryStatus.QUOTED) {
      return null;
    }

    if (previousStatus === InquiryStatus.QUOTED) {
      return null;
    }

    if (!inquiry.userId) {
      return null;
    }

    const serviceLabel =
      inquiry.serviceType?.displayName?.trim() ||
      inquiry.serviceType?.name?.trim() ||
      'Service';

    const row = this.notificationRepository.create({
      userId: inquiry.userId,
      inquiryId: inquiry.id,
      type: NotificationType.INQUIRY_QUOTED,
      title: 'Your quote is ready',
      body: `Your ${serviceLabel} inquiry ${inquiry.code || `#${inquiry.id}`} has been quoted. Open My Inquiries to view details.`,
      metadata: {
        inquiryId: inquiry.id,
        serviceType: inquiry.serviceType?.name ?? null,
        serviceSlug: this.toServiceSlug(inquiry.serviceType?.name),
        status: InquiryStatus.QUOTED,
      },
      readAt: null,
    });

    return this.notificationRepository.save(row);
  }

  async notifyStatusChanged(
    inquiry: ServiceInquiry,
    previousStatus: string,
  ): Promise<Notification | null> {
    if (!inquiry.userId) return null;
    if (inquiry.status === previousStatus) return null;

    const serviceLabel =
      inquiry.serviceType?.displayName?.trim() ||
      inquiry.serviceType?.name?.trim() ||
      'Service';

    const row = this.notificationRepository.create({
      userId: inquiry.userId,
      inquiryId: inquiry.id,
      type: NotificationType.INQUIRY_STATUS_CHANGED,
      title: 'Inquiry status updated',
      body: `Your ${serviceLabel} inquiry ${inquiry.code || `#${inquiry.id}`} status changed from ${previousStatus} to ${inquiry.status}.`,
      metadata: {
        inquiryId: inquiry.id,
        serviceType: inquiry.serviceType?.name ?? null,
        serviceSlug: this.toServiceSlug(inquiry.serviceType?.name),
        previousStatus,
        newStatus: inquiry.status,
      },
      readAt: null,
    });

    return this.notificationRepository.save(row);
  }

  async notifyInternalNewInquiry(inquiry: ServiceInquiry): Promise<void> {
    const internalUsers = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.role', 'role')
      .where('role.roleGroup = :roleGroup', { roleGroup: RoleGroup.INTERNAL })
      .andWhere('user.isActive = true')
      .getMany();

    if (!internalUsers.length) return;

    const serviceLabel =
      inquiry.serviceType?.displayName?.trim() ||
      inquiry.serviceType?.name?.trim() ||
      'Service';

    const rows = internalUsers.map((user) =>
      this.notificationRepository.create({
        userId: user.id,
        inquiryId: inquiry.id,
        type: NotificationType.NEW_INQUIRY,
        title: 'New inquiry received',
        body: `New ${serviceLabel} inquiry ${inquiry.code || `#${inquiry.id}`} from ${inquiry.fullName || inquiry.email || 'Unknown'}.`,
        metadata: {
          inquiryId: inquiry.id,
          serviceType: inquiry.serviceType?.name ?? null,
          serviceSlug: this.toServiceSlug(inquiry.serviceType?.name),
        },
        readAt: null,
      }),
    );

    await this.notificationRepository.save(rows);
  }

  private toServiceSlug(serviceName?: string | null): string | null {
    if (!serviceName?.trim()) {
      return null;
    }

    const normalized = serviceName.trim().toLowerCase();
    if (normalized === 'shipping agency') return 'shipping-agency';
    if (normalized === 'chartering') return 'chartering';
    if (normalized === 'freight forwarding') return 'freight-forwarding';
    if (normalized === 'logistics') return 'total-logistic';
    if (normalized === 'special request') return 'special-request';
    return normalized.replace(/\s+/g, '-');
  }

  private toPayload(row: Notification): Record<string, unknown> {
    return {
      id: row.id,
      userId: row.userId,
      inquiryId: row.inquiryId,
      type: row.type,
      title: row.title,
      body: row.body,
      metadata: row.metadata,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
