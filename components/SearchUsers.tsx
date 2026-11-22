import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Package,
  Plus,
  Car,
  Users,
  X,
  MessageCircle,
  Tag,
  Bike,
  Truck,
  Bus,
  Tractor,
  Ban,
  Info,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { User, Vehicle } from '../types';
import { VehicleCard } from './VehicleCard';
import { db, collection, onSnapshot } from '../firebase';
import { VEHICLE_CATALOG, VehicleCategory, CatalogBrand } from '../constants/vehicleCatalog';

interface SearchUsersProps {
  onSearchUser: (user: User) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
  vehicles: Vehicle[];
  t: any;
  currentUser?: User;
  onFollowToggle?: (user: User) => void;
  isFollowLoading?: boolean;
  onNavigate?: (view: string) => void;
  onOpenChat?: (user: User) => void;
}

function renderCategoryIcon(catId: string, className = 'w-5 h-5 text-gray-700') {
  switch (catId) {
    case 'bike':
    case 'cycle':
      return <Bike className={className} />;
    case 'three-wheeler':
    case 'cars':
      return <Car className={className} />;
    case 'trucks':
    case '10-wheelers':
    case '12-wheelers':
      return <Truck className={className} />;
    case 'buses':
      return <Bus className={className} />;
    case 'tractors':
      return <Tractor className={className} />;
    default:
      return <Car className={className} />;
  }
}

export const SearchUsers: React.FC<SearchUsersProps> = ({
  onSearchUser,
  onSelectVehicle,
  vehicles,
  currentUser,
  onFollowToggle,
  isFollowLoading = false,
  onNavigate,
  onOpenChat
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<'vehicles' | 'users'>('vehicles');
  const [dbUsers, setDbUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);

  // Hierarchical category selection state
  const [selectedCategory, setSelectedCategory] = useState<VehicleCategory | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<CatalogBrand | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Fetch registered users from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const uList: User[] = [];
      snapshot.forEach(d => {
        const u = d.data() as User;
        if (!u.isDeleted && u.suspensionStatus !== 'permanent') {
          uList.push(u);
        }
      });
      setDbUsers(uList);
      setIsLoadingUsers(false);
    }, (err) => {
      console.error('Error loading users for search:', err);
      setDbUsers([]);
      setIsLoadingUsers(false);
    });

    return () => unsub();
  }, []);

  const query = searchTerm.trim().toLowerCase();

  const getVehicleCategory = (v: Vehicle): string => {
    if (v.vehicleType) {
      const vt = v.vehicleType.toLowerCase();
      if (vt.includes('bike') || vt.includes('motorcycle') || vt.includes('scooter') || vt.includes('2w')) return 'bike';
      if (vt.includes('cycle') || vt.includes('bicycle')) return 'cycle';
      if (vt.includes('three') || vt.includes('3w') || vt.includes('auto') || vt.includes('rickshaw')) return 'three-wheeler';
      if (vt.includes('10 wheel') || vt.includes('10-wheel') || vt.includes('10w')) return '10-wheelers';
      if (vt.includes('12 wheel') || vt.includes('12-wheel') || vt.includes('14 wheel') || vt.includes('16 wheel') || vt.includes('12w') || vt.includes('trailer')) return '12-wheelers';
      if (vt.includes('truck') || vt.includes('pickup') || vt.includes('lcv') || vt.includes('tipper')) return 'trucks';
      if (vt.includes('tractor') || vt.includes('farm')) return 'tractors';
      if (vt.includes('bus') || vt.includes('van') || vt.includes('traveller')) return 'buses';
      if (vt.includes('car') || vt.includes('sedan') || vt.includes('suv') || vt.includes('hatchback')) return 'cars';
    }

    const desc = `${v.make || ''} ${v.model || ''} ${v.description || ''}`.toLowerCase();

    if (desc.includes('12 wheeler') || desc.includes('12-wheel') || desc.includes('14 wheeler') || desc.includes('16 wheeler') || desc.includes('3523') || desc.includes('3525') || desc.includes('4225') || desc.includes('4825') || desc.includes('5530') || desc.includes('3520') || desc.includes('4120') || desc.includes('4220') || desc.includes('6035') || desc.includes('6042') || desc.includes('6048')) {
      return '12-wheelers';
    }
    if (desc.includes('10 wheeler') || desc.includes('10-wheel') || desc.includes('10w') || desc.includes('2823') || desc.includes('2825') || desc.includes('2830') || desc.includes('2820') || desc.includes('2822') || desc.includes('6028') || desc.includes('blazo x 28')) {
      return '10-wheelers';
    }
    if (desc.includes('cycle') || desc.includes('bicycle') || desc.includes('mtb') || desc.includes('sprint pro') || desc.includes('firefox') || desc.includes('marlin') || desc.includes('rockrider') || desc.includes('montra') || desc.includes('hercules')) {
      return 'cycle';
    }
    if (desc.includes('rickshaw') || desc.includes('3 wheeler') || desc.includes('three wheeler') || desc.includes('maxima') || desc.includes('ape auto') || desc.includes('ape city') || desc.includes('ape xtra') || desc.includes('treo') || desc.includes('tvs king') || desc.includes('atul gem') || desc.includes('e-rickshaw')) {
      return 'three-wheeler';
    }
    if (desc.includes('motorcycle') || desc.includes('bike') || desc.includes('scooter') || desc.includes('royal enfield') || desc.includes('bullet') || desc.includes('classic 350') || desc.includes('pulsar') || desc.includes('splendor') || desc.includes('activa') || desc.includes('r15') || desc.includes('mt-15') || desc.includes('apache') || desc.includes('ktm duke') || desc.includes('jupiter') || desc.includes('access 125') || desc.includes('ninja') || desc.includes('superbike') || desc.includes('harley')) {
      return 'bike';
    }
    if (desc.includes('truck') || desc.includes('pickup') || desc.includes('tata ace') || desc.includes('chhota hathi') || desc.includes('intra v') || desc.includes('yodha') || desc.includes('407') || desc.includes('bolero pik-up') || desc.includes('bolero maxi') || desc.includes('bada dost') || desc.includes('dost+') || desc.includes('v-cross') || desc.includes('furio') || desc.includes('eicher pro 20')) {
      return 'trucks';
    }
    if (desc.includes('tractor') || desc.includes('john deere') || desc.includes('swaraj') || desc.includes('sonalika') || desc.includes('massey ferguson') || desc.includes('new holland') || desc.includes('novo 605')) {
      return 'tractors';
    }
    if (desc.includes('bus') || desc.includes('coach') || desc.includes('traveller') || desc.includes('urbania') || desc.includes('starbus') || desc.includes('winger')) {
      return 'buses';
    }

    return 'cars';
  };

  const matchesBrand = (vehicle: Vehicle, brand: CatalogBrand): boolean => {
    const vMake = (vehicle.make || '').toLowerCase();
    const bName = brand.name.toLowerCase();
    const bId = brand.id.toLowerCase();

    if (vMake.includes(bName) || bName.includes(vMake)) return true;
    if (bId.includes('maruti') && vMake.includes('maruti')) return true;
    if (bId.includes('hyundai') && vMake.includes('hyundai')) return true;
    if (bId.includes('tata') && vMake.includes('tata')) return true;
    if (bId.includes('mahindra') && vMake.includes('mahindra')) return true;
    if (bId.includes('toyota') && vMake.includes('toyota')) return true;
    if (bId.includes('honda') && vMake.includes('honda')) return true;
    if (bId.includes('royal-enfield') && (vMake.includes('royal') || vMake.includes('enfield'))) return true;
    if (bId.includes('yamaha') && vMake.includes('yamaha')) return true;
    if (bId.includes('bajaj') && vMake.includes('bajaj')) return true;
    if (bId.includes('hero') && vMake.includes('hero')) return true;
    if (bId.includes('tvs') && vMake.includes('tvs')) return true;
    if (bId.includes('ktm') && vMake.includes('ktm')) return true;
    if (bId.includes('bmw') && vMake.includes('bmw')) return true;
    if (bId.includes('mercedes') && (vMake.includes('mercedes') || vMake.includes('benz'))) return true;
    if (bId.includes('audi') && vMake.includes('audi')) return true;
    if (bId.includes('ashok-leyland') && (vMake.includes('ashok') || vMake.includes('leyland'))) return true;
    if (bId.includes('bharatbenz') && vMake.includes('bharat')) return true;
    if (bId.includes('eicher') && vMake.includes('eicher')) return true;
    if (bId.includes('piaggio') && (vMake.includes('piaggio') || vMake.includes('ape'))) return true;
    if (bId.includes('volvo') && vMake.includes('volvo')) return true;

    return false;
  };

  const matchesModel = (vehicle: Vehicle, modelName: string): boolean => {
    const vModel = (vehicle.model || '').toLowerCase();
    const mName = modelName.toLowerCase();

    if (vModel.includes(mName) || mName.includes(vModel)) return true;
    const primaryToken = mName.split(' ')[0];
    if (primaryToken.length > 2 && vModel.includes(primaryToken)) return true;

    return false;
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    VEHICLE_CATALOG.forEach(cat => { counts[cat.id] = 0; });
    vehicles.forEach(v => {
      const catId = getVehicleCategory(v);
      counts[catId] = (counts[catId] || 0) + 1;
    });
    return counts;
  }, [vehicles]);

  const brandCounts = useMemo(() => {
    if (!selectedCategory) return {};
    const counts: Record<string, number> = {};
    const catVehicles = vehicles.filter(v => getVehicleCategory(v) === selectedCategory.id);
    selectedCategory.brands.forEach(b => {
      counts[b.id] = catVehicles.filter(v => matchesBrand(v, b)).length;
    });
    return counts;
  }, [selectedCategory, vehicles]);

  const modelCounts = useMemo(() => {
    if (!selectedBrand || !selectedCategory) return {};
    const counts: Record<string, number> = {};
    const brandVehicles = vehicles.filter(v =>
      getVehicleCategory(v) === selectedCategory.id && matchesBrand(v, selectedBrand)
    );
    selectedBrand.models.forEach(m => {
      counts[m] = brandVehicles.filter(v => matchesModel(v, m)).length;
    });
    return counts;
  }, [selectedBrand, selectedCategory, vehicles]);

  const activeDrilldownVehicles = useMemo(() => {
    if (!selectedCategory) return [];
    let list = vehicles.filter(v => getVehicleCategory(v) === selectedCategory.id);
    if (selectedBrand) {
      list = list.filter(v => matchesBrand(v, selectedBrand));
    }
    if (selectedModel) {
      list = list.filter(v => matchesModel(v, selectedModel));
    }
    return list;
  }, [selectedCategory, selectedBrand, selectedModel, vehicles]);

  const filteredUsers = query
    ? dbUsers.filter(u =>
        (u.username || '').toLowerCase().includes(query) ||
        (u.fullName || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query) ||
        (u.bio || '').toLowerCase().includes(query)
      )
    : dbUsers;

  const filteredVehicles = query
    ? vehicles.filter(v =>
        (v.stockNumber || '').toLowerCase().includes(query) ||
        (v.make || '').toLowerCase().includes(query) ||
        (v.model || '').toLowerCase().includes(query) ||
        (v.vin || '').toLowerCase().includes(query) ||
        (v.ownerUsername || '').toLowerCase().includes(query) ||
        (v.location || '').toLowerCase().includes(query)
      )
    : vehicles;

  const handleResetToCategories = () => {
    setSelectedCategory(null);
    setSelectedBrand(null);
    setSelectedModel(null);
  };

  const handleResetToBrands = () => {
    setSelectedBrand(null);
    setSelectedModel(null);
  };

  const handleResetToModels = () => {
    setSelectedModel(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Search & Explore
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Browse by vehicle categories or search listings, stock numbers, and community members.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('stock')}
              className="px-3.5 py-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 font-medium text-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              title="Lookup 8-9 Digit Stock Number"
            >
              <Package className="w-3.5 h-3.5 text-gray-600" />
              <span>Stock Lookup</span>
            </button>
          )}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('sell')}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>List Your Vehicle</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Mode Toggle Tabs */}
      <div className="flex p-1 bg-gray-100 rounded-lg max-w-md border border-gray-200">
        <button
          type="button"
          onClick={() => setSearchMode('vehicles')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer tabular-nums ${
            searchMode === 'vehicles'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Car className="w-3.5 h-3.5" />
          <span>Vehicles ({vehicles.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSearchMode('users')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer tabular-nums ${
            searchMode === 'users'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Profiles ({filteredUsers.length})</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="relative">
        <input
          type="text"
          placeholder={
            searchMode === 'vehicles'
              ? 'Search by 8-9 digit Stock #, make, model, year, VIN, or location...'
              : 'Search profiles by username, name, or email...'
          }
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-10 py-3 bg-white border border-gray-200 rounded-lg shadow-xs text-sm focus:outline-none focus:border-red-600 transition-colors placeholder:text-gray-400"
        />
        <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* USER PROFILES SEARCH MODE */}
      {searchMode === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-500 tabular-nums">
              {query ? `Search Results (${filteredUsers.length})` : `Community Profiles (${filteredUsers.length})`}
            </span>
          </div>

          {isLoadingUsers ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
              <p className="text-xs font-medium">Loading community profiles...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <div className="w-11 h-11 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
                <Users className="w-5 h-5" />
              </div>
              <p className="font-semibold text-sm text-gray-900">No profiles found</p>
              <p className="text-xs text-gray-500 mt-1">Try searching with a different username or keyword.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredUsers.map(user => {
                const isMe = Boolean(currentUser?.id && user.id === currentUser.id);
                const isFollowing = Boolean(currentUser?.followingIds?.includes(user.id));
                const followsMe = Boolean(
                  (user.followingIds && currentUser?.id && user.followingIds.includes(currentUser.id)) ||
                  (currentUser?.followersIds && currentUser.followersIds.includes(user.id))
                );

                return (
                  <div
                    key={user.id}
                    onClick={() => onSearchUser(user)}
                    className="bg-white border border-gray-200 p-4 rounded-lg flex items-center justify-between gap-3 cursor-pointer hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <img
                        src={user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'}
                        alt={user.username}
                        className="w-11 h-11 rounded-full border border-gray-200 object-cover shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-semibold text-gray-900 text-xs sm:text-sm truncate">
                            @{user.username}
                          </h3>
                          {user.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{user.fullName || 'AutoBid Member'}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 tabular-nums">
                          <span>{user.followers || 0} followers</span>
                          {followsMe && <span>· Follows you</span>}
                          {user.role && user.role !== 'user' && (
                            <span className="uppercase font-medium text-gray-500">· {user.role}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {!isMe && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onOpenChat && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenChat(user);
                            }}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title={`Chat with @${user.username}`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Chat</span>
                          </button>
                        )}

                        {onFollowToggle && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFollowToggle(user);
                            }}
                            disabled={isFollowLoading}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                              isFollowing
                                ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                                : 'bg-red-600 hover:bg-red-700 text-white'
                            }`}
                          >
                            {isFollowing ? 'Following' : followsMe ? 'Follow Back' : 'Follow'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VEHICLES SEARCH & CATEGORY DRILLDOWN MODE */}
      {searchMode === 'vehicles' && (
        <div className="space-y-6">
          {query ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-500 tabular-nums">
                  Search Results for "{searchTerm}" ({filteredVehicles.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-xs text-red-600 font-semibold hover:underline cursor-pointer"
                >
                  Clear Search
                </button>
              </div>

              {filteredVehicles.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200 p-8 space-y-3">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                    <Search className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">No vehicles matching "{searchTerm}"</h3>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    Try searching for another make (e.g. Maruti, Tata, Royal Enfield) or browse vehicle categories below.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    View All Categories
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredVehicles.map(vehicle => (
                    <VehicleCard
                      key={vehicle.id}
                      vehicle={vehicle}
                      onClick={() => onSelectVehicle(vehicle)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Breadcrumb Bar */}
              <div className="bg-white p-3.5 rounded-lg border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold flex-wrap">
                  <button
                    type="button"
                    onClick={handleResetToCategories}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      !selectedCategory ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Car className="w-3.5 h-3.5" />
                    <span>All Vehicle Types</span>
                  </button>

                  {selectedCategory && (
                    <>
                      <span className="text-gray-300">/</span>
                      <button
                        type="button"
                        onClick={handleResetToBrands}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          !selectedBrand ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        {renderCategoryIcon(selectedCategory.id, 'w-3.5 h-3.5')}
                        <span>{selectedCategory.shortName}</span>
                      </button>
                    </>
                  )}

                  {selectedBrand && (
                    <>
                      <span className="text-gray-300">/</span>
                      <button
                        type="button"
                        onClick={handleResetToModels}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          !selectedModel ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        <Tag className="w-3.5 h-3.5" />
                        <span>{selectedBrand.name}</span>
                      </button>
                    </>
                  )}

                  {selectedModel && (
                    <>
                      <span className="text-gray-300">/</span>
                      <span className="bg-gray-900 text-white px-2.5 py-1 rounded-lg">
                        {selectedModel}
                      </span>
                    </>
                  )}
                </div>

                {selectedCategory && (
                  <button
                    type="button"
                    onClick={handleResetToCategories}
                    className="text-xs text-gray-500 hover:text-gray-900 font-medium cursor-pointer"
                  >
                    Reset Filter
                  </button>
                )}
              </div>

              {/* LEVEL 1: ALL VEHICLE CATEGORIES */}
              {!selectedCategory && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Select Vehicle Category</h3>
                    <p className="text-xs text-gray-500">Pick a vehicle category to browse brands and models.</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {VEHICLE_CATALOG.map(category => {
                      const count = categoryCounts[category.id] || 0;
                      return (
                        <div
                          key={category.id}
                          onClick={() => {
                            setSelectedCategory(category);
                            setSelectedBrand(null);
                            setSelectedModel(null);
                          }}
                          className="bg-white border border-gray-200 hover:border-gray-900 p-4 rounded-lg shadow-xs cursor-pointer transition-colors flex flex-col justify-between"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center">
                                {renderCategoryIcon(category.id, 'w-5 h-5 text-gray-700')}
                              </div>
                              <span className="text-xs font-medium text-gray-500">
                                {category.wheelCount}
                              </span>
                            </div>

                            <div>
                              <h4 className="text-sm font-bold text-gray-900">
                                {category.name}
                              </h4>
                              <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                                {category.description}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between text-xs tabular-nums">
                            <span className="text-gray-500 font-medium">
                              {category.brands.length} Brands
                            </span>
                            <span className={`font-semibold ${count > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                              {count > 0 ? `${count} Listed` : 'Browse'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* LEVEL 2: BRANDS GRID */}
              {selectedCategory && !selectedBrand && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                        {renderCategoryIcon(selectedCategory.id, 'w-4 h-4 text-gray-700')}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-gray-900">{selectedCategory.name} Brands</h3>
                        <p className="text-xs text-gray-500">Select a manufacturer to view available models</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetToCategories}
                      className="self-start sm:self-auto text-xs font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Change Vehicle Type</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {selectedCategory.brands.map(brand => {
                      const count = brandCounts[brand.id] || 0;
                      return (
                        <div
                          key={brand.id}
                          onClick={() => {
                            setSelectedBrand(brand);
                            setSelectedModel(null);
                          }}
                          className={`p-4 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between ${
                            count > 0
                              ? 'bg-white border-gray-300 hover:border-gray-900'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-900 hover:bg-white'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Tag className="w-4 h-4 text-gray-500" />
                              {brand.country && (
                                <span className="text-xs text-gray-400">{brand.country}</span>
                              )}
                            </div>
                            <h4 className="font-bold text-xs sm:text-sm text-gray-900 leading-snug">
                              {brand.name}
                            </h4>
                            <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                              {brand.models.length} Models
                            </p>
                          </div>

                          <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between text-xs tabular-nums">
                            <span className={`font-semibold ${count > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                              {count > 0 ? `${count} Available` : '0 Available'}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* LEVEL 3: MODELS GRID */}
              {selectedCategory && selectedBrand && !selectedModel && (
                <div className="space-y-6">
                  <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                          <Tag className="w-5 h-5 text-gray-700" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-gray-900">{selectedBrand.name}</h3>
                            <span className="text-xs text-gray-500">({selectedCategory.shortName})</span>
                          </div>
                          <p className="text-xs text-gray-500">
                            Select a vehicle model to view active listings on AutoBid
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleResetToBrands}
                        className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium transition-colors inline-flex items-center gap-1 cursor-pointer self-start sm:self-auto"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Change Brand</span>
                      </button>
                    </div>

                    {(brandCounts[selectedBrand.id] || 0) === 0 && (
                      <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <Info className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="block font-semibold text-gray-900">
                              No vehicle of {selectedBrand.name} is currently available
                            </strong>
                            <span className="text-gray-600">
                              No user has listed a {selectedBrand.name} in {selectedCategory.name} yet.
                            </span>
                          </div>
                        </div>
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => onNavigate('sell')}
                            className="shrink-0 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            List a {selectedBrand.name}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider tabular-nums">
                      {selectedBrand.name} Models ({selectedBrand.models.length})
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {selectedBrand.models.map(model => {
                        const count = modelCounts[model] || 0;
                        return (
                          <div
                            key={model}
                            onClick={() => setSelectedModel(model)}
                            className={`p-4 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between ${
                              count > 0
                                ? 'bg-white border-emerald-500 shadow-xs'
                                : 'bg-white border-gray-200 hover:border-gray-900'
                            }`}
                          >
                            <div>
                              <span className="text-xs text-gray-400 block">Model</span>
                              <h5 className="font-bold text-xs sm:text-sm text-gray-900 mt-0.5 leading-snug">
                                {model}
                              </h5>
                            </div>

                            <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between text-xs tabular-nums">
                              <span className={`font-semibold ${count > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                                {count > 0 ? `${count} Available` : 'Check Model'}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* LEVEL 4: LISTED VEHICLES FOR SELECTED MODEL */}
              {selectedCategory && selectedBrand && selectedModel && (
                <div className="space-y-6">
                  <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                        {renderCategoryIcon(selectedCategory.id, 'w-5 h-5 text-gray-700')}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-gray-900">
                          {selectedBrand.name} {selectedModel}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {selectedCategory.name} · {selectedBrand.name}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetToModels}
                        className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium transition-colors inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Other Models</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResetToBrands}
                        className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium transition-colors inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Other Brands</span>
                      </button>
                    </div>
                  </div>

                  {activeDrilldownVehicles.length === 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4 shadow-xs">
                      <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center mx-auto">
                        <Ban className="w-5 h-5" />
                      </div>

                      <div className="space-y-1">
                        <h4 className="text-base font-bold text-gray-900">
                          No vehicle of {selectedBrand.name} {selectedModel} is available
                        </h4>
                        <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                          Currently no user has listed a <strong>{selectedBrand.name} {selectedModel}</strong> on AutoBid.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => onNavigate('sell')}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                          >
                            List a {selectedBrand.name} {selectedModel}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleResetToModels}
                          className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                        >
                          Browse Other {selectedBrand.name} Models
                        </button>
                        <button
                          type="button"
                          onClick={handleResetToBrands}
                          className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                        >
                          Explore Other Brands
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <span className="text-xs font-semibold text-gray-500 tabular-nums block">
                        Active Listings ({activeDrilldownVehicles.length})
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {activeDrilldownVehicles.map(vehicle => (
                          <VehicleCard
                            key={vehicle.id}
                            vehicle={vehicle}
                            onClick={() => onSelectVehicle(vehicle)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
