import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useUserFollows } from '@/hooks/useUserFollows';
import {
  useArbiterAnnouncements,
  useTaskProposals,
  useMyArbiterServices,
  useMyTasks,
  useTasksForWorker,
  useTasksForArbiter,
  useCatallaxInvalidation,
  useArbiterExperience
} from '@/hooks/useCatallax';
import { LoginArea } from '@/components/auth/LoginArea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { ArbiterCard } from '@/components/catallax/ArbiterCard';
import { TaskCard } from '@/components/catallax/TaskCard';
import { ArbiterAnnouncementForm } from '@/components/catallax/ArbiterAnnouncementForm';
import { TaskProposalForm } from '@/components/catallax/TaskProposalForm';
import { TaskManagement } from '@/components/catallax/TaskManagement';
import { TaskFilters, applyTaskFilters, type TaskFilterState } from '@/components/catallax/TaskFilters';
import { ArbiterFilters, applyArbiterFilters, type ArbiterFilterState } from '@/components/catallax/ArbiterFilters';
import { Plus, Shield, Briefcase, User, Search, Settings, Info } from 'lucide-react';
import { NutzapWalletSetup } from '@/components/NutzapWalletSetup';
import { CATALLAX_KINDS, type TaskProposal } from '@/lib/catallax';

export default function CatallaxDashboard() {

  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const { invalidateAllCatallaxQueries } = useCatallaxInvalidation();
  const [activeTab, setActiveTab] = useState('discover');
  const [showCreateArbiter, setShowCreateArbiter] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskProposal | null>(null);

  // Data queries
  const { data: arbiters = [], isLoading: arbitersLoading } = useArbiterAnnouncements();
  const { data: allTasks = [], isLoading: tasksLoading } = useTaskProposals();

  // User-specific queries
  const { data: myServices = [] } = useMyArbiterServices(user?.pubkey);
  const { data: myTasks = [] } = useMyTasks(user?.pubkey);
  const { data: workerTasks = [] } = useTasksForWorker(user?.pubkey);
  const { data: arbiterTasks = [] } = useTasksForArbiter(user?.pubkey);

  // User follows for filtering
  const { data: userFollows = [] } = useUserFollows(user?.pubkey);
  const arbiterExperience = useArbiterExperience();

  // Filter states
  const [discoverSubTab, setDiscoverSubTab] = useState<'tasks' | 'arbiters'>('tasks');

  // Task filter state
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>({
    status: 'all',
    fundingType: 'all',
    sortField: 'date',
    sortDirection: 'desc',
    selectedTags: [],
    onlyFollowing: true,
    hideConcluded: true,
  });

  // Arbiter filter state
  const [arbiterFilters, setArbiterFilters] = useState<ArbiterFilterState>({
    sortField: 'date',
    sortDirection: 'desc',
    onlyFollowing: false,
  });

  // Apply filters to tasks
  const filteredTasks = useMemo(() =>
    applyTaskFilters(allTasks, taskFilters, userFollows, user?.pubkey),
    [allTasks, taskFilters, userFollows, user?.pubkey]
  );

  // Apply filters to arbiters
  const filteredArbiters = useMemo(() =>
    applyArbiterFilters(arbiters, arbiterFilters, userFollows, arbiterExperience, user?.pubkey),
    [arbiters, arbiterFilters, userFollows, arbiterExperience, user?.pubkey]
  );

  // For active tasks tab (still uses simple filter)
  const activeTasks = allTasks.filter(task => ['in_progress', 'submitted'].includes(task.status));

  const handleTaskManage = (task: TaskProposal) => {
    setSelectedTask(task);
    setActiveTab('manage');
  };

  const handleTaskFund = (task: TaskProposal, zapReceiptId: string, receiptType: 'zap' | 'nutzap') => {
    // Seamlessly update task status to "funded" after Lightning payment completes
    const content = task.content;
    const tags: string[][] = [
      ['d', task.d],
      ['p', task.patronPubkey],
      ['amount', task.amount],
      ['t', 'catallax'],
      ['status', 'funded'],
      ['e', zapReceiptId, '', receiptType],
    ];

    if (task.arbiterPubkey) {
      tags.push(['p', task.arbiterPubkey]);
    }

    if (task.arbiterService) {
      tags.push(['a', task.arbiterService]);
    }

    if (task.detailsUrl) {
      tags.push(['r', task.detailsUrl]);
    }

    // Add task categories
    task.categories.forEach(category => {
      if (category !== 'catallax') {
        tags.push(['t', category]);
      }
    });

    // Automatically publish updated task proposal with funded status
    createEvent({
      kind: CATALLAX_KINDS.TASK_PROPOSAL,
      content: JSON.stringify(content),
      tags,
    }, {
      onSuccess: () => {
        toast({
          title: 'Task Funded Successfully!',
          description: `"${task.content.title}" is now funded and ready for worker assignment.`,
        });

        // Invalidate all catallax queries to refresh the UI
        invalidateAllCatallaxQueries();
      },
    });
  };

  if (selectedTask && activeTab === 'manage') {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedTask(null);
              setActiveTab('dashboard');
            }}
          >
            ← Back to Dashboard
          </Button>
        </div>
        <TaskManagement
          task={selectedTask}
          realZapsEnabled={true}
          onUpdate={() => {
            setSelectedTask(null);
            setActiveTab('dashboard');
            invalidateAllCatallaxQueries();
          }}
        />
      </div>
    );
  }

  if (showCreateArbiter) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowCreateArbiter(false)}>
            ← Back to Dashboard
          </Button>
        </div>
        <ArbiterAnnouncementForm onSuccess={() => setShowCreateArbiter(false)} />
      </div>
    );
  }

  if (showCreateTask) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowCreateTask(false)}>
            ← Back to Dashboard
          </Button>
        </div>
        <TaskProposalForm onSuccess={() => setShowCreateTask(false)} />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Catallax - Decentralized Gigs</title>
        <meta name="description" content="A protocol for decentralized contract work on Nostr" />
      </Helmet>

      <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">Catallax</h1>
            <p className="text-muted-foreground">Decentralized, uncensorable gig work</p>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/about">
                <Info className="h-4 w-4 mr-2" />
                About
              </Link>
            </Button>
            <RelaySelector />
            <LoginArea className="max-w-60" />
          </div>
        </div>

        {user && (
          <div className="flex gap-2">
            <Button onClick={() => setShowCreateArbiter(true)} variant="outline">
              <Shield className="h-4 w-4 mr-2" />
              Create Arbiter Service
            </Button>
            <Button onClick={() => setShowCreateTask(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="discover">
            <Search className="h-4 w-4 mr-2" />
            Discover
          </TabsTrigger>
          <TabsTrigger value="dashboard">
            <User className="h-4 w-4 mr-2" />
            My Dashboard
          </TabsTrigger>
          <TabsTrigger value="active">
            <Briefcase className="h-4 w-4 mr-2" />
            Active Tasks
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-4">
          {/* Sub-tabs for Tasks and Arbiters */}
          <Tabs value={discoverSubTab} onValueChange={(v) => setDiscoverSubTab(v as 'tasks' | 'arbiters')}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="tasks" className="gap-2">
                <Briefcase className="h-4 w-4" />
                Tasks
                <Badge variant="secondary" className="ml-1">{filteredTasks.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="arbiters" className="gap-2">
                <Shield className="h-4 w-4" />
                Arbiters
                <Badge variant="secondary" className="ml-1">{filteredArbiters.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {/* Tasks Sub-Tab */}
            <TabsContent value="tasks" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Filter & Sort Tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  <TaskFilters
                    tasks={allTasks}
                    filters={taskFilters}
                    onFiltersChange={setTaskFilters}
                    userFollows={userFollows}
                    isLoggedIn={!!user}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5" />
                    Available Tasks
                    <Badge variant="secondary">{filteredTasks.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Browse and filter tasks from the network
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {tasksLoading ? (
                    <div className="space-y-4">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full" />
                      ))}
                    </div>
                  ) : filteredTasks.length > 0 ? (
                    <div className="space-y-4 max-h-[calc(100vh-400px)] min-h-[400px] overflow-y-auto pr-2">
                      {filteredTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showApplyButton={task.status === 'funded' && !task.workerPubkey && user?.pubkey !== task.patronPubkey}
                          showFundButton={task.status === 'proposed' && !!user && !!task.arbiterPubkey}
                          realZapsEnabled={true}
                          onApply={(task) => {
                            alert(`To apply for "${task.content.title}", contact the patron out-of-band. Task ID: ${task.d}`);
                          }}
                          onFund={handleTaskFund}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground mb-4">No tasks match your filters</p>
                      <div className="flex flex-col items-center gap-4">
                        <Button
                          variant="outline"
                          onClick={() => setTaskFilters({
                            status: 'all',
                            fundingType: 'all',
                            sortField: 'date',
                            sortDirection: 'desc',
                            selectedTags: [],
                            onlyFollowing: true,
                            hideConcluded: true,
                          })}
                        >
                          Reset Filters
                        </Button>
                        <RelaySelector />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Arbiters Sub-Tab */}
            <TabsContent value="arbiters" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Filter & Sort Arbiters</CardTitle>
                </CardHeader>
                <CardContent>
                  <ArbiterFilters
                    filters={arbiterFilters}
                    onFiltersChange={setArbiterFilters}
                    userFollows={userFollows}
                    isLoggedIn={!!user}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Available Arbiters
                    <Badge variant="secondary">{filteredArbiters.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Arbiters offering escrow services
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {arbitersLoading ? (
                    <div className="space-y-4">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full" />
                      ))}
                    </div>
                  ) : filteredArbiters.length > 0 ? (
                    <div className="space-y-4 max-h-[calc(100vh-400px)] min-h-[400px] overflow-y-auto pr-2">
                      {filteredArbiters.map((arbiter) => (
                        <div key={arbiter.id} className="relative">
                          <ArbiterCard arbiter={arbiter} />
                          {arbiterFilters.sortField === 'experience' && (
                            <Badge
                              variant="outline"
                              className="absolute top-2 right-2"
                            >
                              {arbiterExperience.get(arbiter.arbiterPubkey) || 0} completed
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground mb-4">No arbiters match your filters</p>
                      <div className="flex flex-col items-center gap-4">
                        <Button
                          variant="outline"
                          onClick={() => setArbiterFilters({
                            sortField: 'date',
                            sortDirection: 'desc',
                            onlyFollowing: false,
                          })}
                        >
                          Reset Filters
                        </Button>
                        <RelaySelector />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-6">
          {!user ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-4">Please log in to view your dashboard</p>
                <LoginArea className="max-w-60 mx-auto" />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* My Services */}
              <Card>
                <CardHeader>
                  <CardTitle>My Arbiter Services</CardTitle>
                  <CardDescription>Services you're offering</CardDescription>
                </CardHeader>
                <CardContent>
                  {myServices.length > 0 ? (
                    <div className="space-y-4">
                      {myServices.map((service) => (
                        <ArbiterCard key={service.id} arbiter={service} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-4">No arbiter services created</p>
                      <Button onClick={() => setShowCreateArbiter(true)} variant="outline">
                        Create Service
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* My Tasks */}
              <Card>
                <CardHeader>
                  <CardTitle>My Tasks</CardTitle>
                  <CardDescription>Tasks you've created</CardDescription>
                </CardHeader>
                <CardContent>
                  {myTasks.length > 0 ? (
                    <div className="space-y-4">
                      {myTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showManageButton
                          showFundButton
                          realZapsEnabled={true}
                          onManage={handleTaskManage}
                          onFund={handleTaskFund}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-4">No tasks created</p>
                      <Button onClick={() => setShowCreateTask(true)} variant="outline">
                        Create Task
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tasks I'm Working On */}
              {workerTasks.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Tasks I'm Working On</CardTitle>
                    <CardDescription>Tasks assigned to you</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {workerTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showManageButton
                          onManage={handleTaskManage}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tasks I'm Arbitrating */}
              {arbiterTasks.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Tasks I'm Arbitrating</CardTitle>
                    <CardDescription>Tasks using your arbiter services</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {arbiterTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showManageButton
                          onManage={handleTaskManage}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="active" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Active Tasks</CardTitle>
              <CardDescription>Tasks currently in progress or submitted for review</CardDescription>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-48 w-full" />
                  ))}
                </div>
              ) : activeTasks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No active tasks found</p>
                  <RelaySelector className="mt-4" />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Application settings</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Lightning payments are always enabled. All transactions use real Bitcoin via Lightning Network.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <NutzapWalletSetup />
        </TabsContent>
      </Tabs>

      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          Vibed with{' '}
          <a
            href="https://soapbox.pub/mkstack"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            MKStack
          </a>
        </p>
      </div>
    </div>
    </>
  );
}
