import { Module } from '@nestjs/common';
import { ProxyManagerService } from './proxy-manager.service';

@Module({
  providers: [ProxyManagerService],
  exports: [ProxyManagerService],
})
export class ProxyManagerModule {}

