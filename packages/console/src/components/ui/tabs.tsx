import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import type { ForwardRefExoticComponent, JSX, PropsWithoutRef, RefAttributes } from 'react';
import { cn } from '../../lib/utils';

type TabsListElement = React.ElementRef<typeof TabsPrimitive.List>;
type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>;
type TabsListComponent = ForwardRefExoticComponent<PropsWithoutRef<TabsListProps> & RefAttributes<TabsListElement>>;

type TabsTriggerElement = React.ElementRef<typeof TabsPrimitive.Trigger>;
type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;
type TabsTriggerComponent = ForwardRefExoticComponent<
  PropsWithoutRef<TabsTriggerProps> & RefAttributes<TabsTriggerElement>
>;

type TabsContentElement = React.ElementRef<typeof TabsPrimitive.Content>;
type TabsContentProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;
type TabsContentComponent = ForwardRefExoticComponent<
  PropsWithoutRef<TabsContentProps> & RefAttributes<TabsContentElement>
>;

const Tabs: typeof TabsPrimitive.Root = TabsPrimitive.Root;

const TabsList: TabsListComponent = React.forwardRef<TabsListElement, TabsListProps>(function TabsList(
  { className, ...props }: TabsListProps,
  ref: React.ForwardedRef<TabsListElement>,
): JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-field bg-muted p-1 text-muted-foreground',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger: TabsTriggerComponent = React.forwardRef<TabsTriggerElement, TabsTriggerProps>(function TabsTrigger(
  { className, ...props }: TabsTriggerProps,
  ref: React.ForwardedRef<TabsTriggerElement>,
): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-control px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent: TabsContentComponent = React.forwardRef<TabsContentElement, TabsContentProps>(function TabsContent(
  { className, ...props }: TabsContentProps,
  ref: React.ForwardedRef<TabsContentElement>,
): JSX.Element {
  return (
    <TabsPrimitive.Content
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
