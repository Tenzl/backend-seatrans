import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

type AuthenticatedRequest = Request & { user?: { id?: number } };

@UseGuards(AuthGuard('jwt'))
@Controller('v1/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  list(@Query() query: ListNotificationsQueryDto, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      return { items: [], unreadCount: 0 };
    }
    return this.notificationService.listForUser(userId, query);
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      return { count: 0 };
    }
    return this.notificationService.countUnread(userId).then((count) => ({ count }));
  }

  @Patch('read-all')
  markAllRead(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      return { updated: 0 };
    }
    return this.notificationService.markAllAsRead(userId);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return null;
    }
    return this.notificationService.markAsRead(userId, id);
  }
}
